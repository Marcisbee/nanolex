/**
 * CSS (subset) parser migrated to nanolex3 API.
 *
 * Supported features:
 *  - Rulesets: selector { declarations }
 *  - @keyframes with percentage & from/to frames
 *  - @media queries with basic conditions & features
 *  - Selectors: tag, .class, #id, *, attribute selectors, pseudo selectors
 *  - Combinators: + > ~ (descendant via whitespace), column (|| simulated using '||')
 *  - Values: numbers (+ optional units), hex colors, time units, strings, functions, variables (--var)
 *  - Important flag: !important
 *
 * Note: This is a pragmatic subset; not a full CSS specification implementation.
 */

import {
  and,
  consume,
  consumeUntil,
  createParser,
  createToken,
  EOF,
  not,
  oneOrManySep,
  or,
  peek,
  rule,
  zeroOrMany,
  zeroOrManySep,
  zeroOrOne,
} from "../src/nanolex.ts";

/* -------------------------------------------------------------------------- */
/* Tokens (order matters for splitting)                                       */
/* -------------------------------------------------------------------------- */

const LineBreak = createToken(/[\n\r]/, "LineBreak");
const Whitespace = createToken(/[ \t]+/, "Whitespace");
const QuoteDouble = createToken(`"`, "QuoteDouble");
const QuoteSingle = createToken(`'`, "QuoteSingle");
const LParen = createToken("(");
const RParen = createToken(")");
const LSquare = createToken("[");
const RSquare = createToken("]");
const LCurly = createToken("{");
const RCurly = createToken("}");
const Lt = createToken("<");
const Gt = createToken(">");
const Exclamation = createToken("!");
const Semicolon = createToken(";");
const Colon = createToken(":");
const Comma = createToken(",");
const Namespace = createToken("|");
const Tilde = createToken("~");
const Caret = createToken("^");
const Dolar = createToken("$");
const At = createToken("@");
const Percentage = createToken("%", "PercentSymbol");
const Dot = createToken(".");
const Plus = createToken("+");
const Minus = createToken("-");
const Equal = createToken("=");
const Hash = createToken("#");
const Star = createToken("*");
const Important = createToken("important");
const Hex = createToken(/#(?:(?:[0-9a-fA-F]{2}){3}|(?:[0-9a-fA-F]){3})/, "Hex");
const CaseInsensitive = createToken(/[iI]/, "i");
const CaseSensitive = createToken(/[sS]/, "s");
const CSSUnits = createToken(
  /em|ex|%|px|cm|mm|in|pt|pc|ch|rem|vh|vw|vmin|vmax|deg/,
  "Unit",
);
const CSSTime = createToken(/ms|s|m/, "Time");
const NumberLiteral = createToken(
  /-?(?:0|[1-9]\d*)?(?:\.\d+)?(?:[eE][+-]?\d+)?/,
  "NumberLiteral",
);
const StringLiteral = createToken(/[a-zA-Z_$][a-zA-Z0-9_$-]*/, "Ident");
const FromTo = createToken(/from|to/, "FromTo");
const Keyframes = createToken("keyframes");
const Media = createToken("media");
const And = createToken("and");
const OrToken = createToken("or");
const Only = createToken("only");
const Not = createToken("not");

/**
 * Order intentionally groups structural tokens early; identifiers & numbers later.
 */
const tokens = [
  Whitespace,
  LineBreak,
  LParen,
  RParen,
  LSquare,
  RSquare,
  LCurly,
  RCurly,
  Lt,
  Gt,
  QuoteDouble,
  QuoteSingle,
  Exclamation,
  Semicolon,
  Colon,
  Comma,
  Namespace,
  Tilde,
  Caret,
  Dolar,
  At,
  Hex,
  Hash,
  Star,
  Important,
  StringLiteral,
  NumberLiteral,
  CSSUnits,
  CSSTime,
  Plus,
  Minus,
  Equal,
  Dot,
  Percentage,
  FromTo,
  Keyframes,
  Media,
  And,
  OrToken,
  Only,
  Not,
];

/* -------------------------------------------------------------------------- */
/* Parser definition                                                          */
/* -------------------------------------------------------------------------- */

const cssParser = createParser(
  tokens,
  {
    PROGRAM() {
      return zeroOrMany(or([
        rule(this.RULESET),
        rule(this.KEYFRAMES),
        rule(this.MEDIA),
      ]));
    },

    /* ------------------------------ @keyframes ------------------------------ */
    KEYFRAMES() {
      return and([
        consume(At),
        consume(Keyframes),
        consume(StringLiteral),
        consume(LCurly),
        zeroOrMany(
          and([
            oneOrManySep(
              or([
                consume(FromTo),
                and([
                  consume(NumberLiteral),
                  consume(Percentage),
                ], ([value]) => Number(value)),
              ]),
              consume(Comma),
            ),
            rule(this.DECLARATIONS_GROUP),
          ], ([selectors, rules]) => ({
            type: "frame",
            selectors,
            rules,
          })),
        ),
        consume(RCurly),
      ], ([, , name, , ruleset]) => ({
        type: "atrule",
        scope: "keyframes",
        name,
        ruleset,
      }));
    },

    /* -------------------------------- @media -------------------------------- */
    MEDIA() {
      return and([
        consume(At),
        consume(Media),
        rule(this.MEDIA_QUERIES),
        consume(LCurly),
        zeroOrMany(rule(this.RULESET)),
        consume(RCurly),
      ], ([, , query, , ruleset]) => ({
        type: "atrule",
        scope: "media",
        query,
        ruleset,
      }));
    },

    MEDIA_QUERIES() {
      return oneOrManySep(
        rule(this.MEDIA_QUERY),
        consume(Comma),
      );
    },

    MEDIA_QUERY() {
      return or([
        and([
          or([
            consume(Only),
            consume(Not),
          ]),
          consume(StringLiteral),
          zeroOrOne(and([
            consume(And),
            rule(this.MEDIA_CONDITION),
          ], ([scope, value]) => ({
            type: "media-query-condition",
            scope,
            value,
          }))),
        ], ([scope, mediaType, condition]) => ({
          type: "media-query",
          scope,
          media_type: mediaType,
          condition,
        })),
        rule(this.MEDIA_CONDITION),
      ]);
    },

    MEDIA_CONDITION() {
      return or([
        rule(this.MEDIA_FEATURE),
        consume(StringLiteral),
      ]);
    },

    MEDIA_FEATURE() {
      return and([
        consume(LParen),
        or([
          and([
            consume(StringLiteral),
            consume(Colon),
            rule(this.VALUE),
          ], ([name, , value]) => ({
            type: "feature-name",
            name,
            value,
          })),
          consume(StringLiteral, (name) => ({
            type: "feature-name",
            name,
          })),
        ]),
        consume(RParen),
      ], ([, value]) => ({
        type: "media-feature",
        value,
      }));
    },

    /* ----------------------------- Declarations ----------------------------- */
    DECLARATIONS_GROUP() {
      return and([
        consume(LCurly),
        zeroOrMany(rule(this.DECLARATION)),
        consume(RCurly),
      ], ([, declarations]) => declarations);
    },

    DECLARATION() {
      return and([
        or([
          rule(this.VARIABLE),
          consume(StringLiteral, (name) => ({
            type: "literal",
            name,
          })),
        ]),
        consume(Colon),
        rule(this.VALUE),
        rule(this.IMPORTANT_FLAG),
        or([consume(Semicolon), peek(consume(RCurly))]),
      ], ([name, , value, isImportant]) => ({
        type: "rule",
        name,
        value,
        important: !!isImportant,
      }));
    },

    IMPORTANT_FLAG() {
      return zeroOrOne(
        and([consume(Exclamation), consume(Important)], () => true),
      );
    },

    /* --------------------------------- Value -------------------------------- */
    VALUE() {
      return oneOrManySep(
        or([
          rule(this.VARIABLE),
          consume(Hex),
          and([
            consume(NumberLiteral, Number),
            consume(CSSTime),
          ], ([value, unit]) => ({
            type: "time",
            value,
            unit,
          })),
          and([
            consume(NumberLiteral, Number),
            zeroOrOne(consume(CSSUnits)),
          ], ([value, unit]) => ({
            type: "size",
            value,
            unit,
          })),
          rule(this.FUNCTION),
          and([
            consume(QuoteDouble),
            consumeUntil(QuoteDouble),
            consume(QuoteDouble),
          ], ([, value]) => ({
            type: "text",
            value: (value || []).join(""),
          })),
          and([
            consume(QuoteSingle),
            consumeUntil(QuoteSingle),
            consume(QuoteSingle),
          ], ([, value]) => ({
            type: "text",
            value: (value || []).join(""),
          })),
          consume(StringLiteral),
        ]),
        consume(Whitespace),
      );
    },

    FUNCTION() {
      return and([
        consume(StringLiteral),
        consume(LParen),
        zeroOrManySep(rule(this.VALUE), consume(Comma)),
        consume(RParen),
      ], ([name, , value]) => ({
        type: "fn",
        name,
        value,
      }));
    },

    VARIABLE() {
      return and([
        consume(Minus),
        consume(Minus),
        consume(StringLiteral),
      ], ([, , name]) => ({
        type: "variable",
        name,
      }));
    },

    /* -------------------------------- Selectors ----------------------------- */
    RULESET() {
      return and([
        rule(this.SELECTORS),
        rule(this.DECLARATIONS_GROUP),
      ], ([selectors, rules]) => ({
        type: "ruleset",
        selectors,
        rules,
      }));
    },

    SELECTORS() {
      return oneOrManySep(rule(this.SELECTOR_SEPARATOR), consume(Comma));
    },

    SELECTOR_SEPARATOR() {
      return and([
        rule(this.SELECTOR_COMBINATOR),
        zeroOrOne(and([
          consume(Namespace),
          rule(this.SELECTOR_SEPARATOR),
        ])),
      ], ([left, right]) => {
        if (!right) return left;
        return {
          type: "selector",
          scope: "separator",
          value: [left].concat(right),
        };
      });
    },

    SELECTOR_COMBINATOR() {
      return and([
        rule(this.SELECTOR_CHAIN),
        zeroOrOne(and([
          or([
            consume(Plus), // adjacent sibling
            consume(Gt), // child
            and([consume(Namespace), consume(Namespace)]), // column (||)
            consume(Tilde), // general sibling
            consume(Whitespace), // descendant
          ]),
          rule(this.SELECTOR_COMBINATOR),
        ])),
      ], ([left, right]) => {
        if (!right) return left;
        return {
          type: "selector",
          scope: "combinator",
          value: [left].concat(right.flat(1)),
        };
      });
    },

    SELECTOR_CHAIN() {
      // Use negative lookahead for whitespace as pseudo-separator
      return oneOrManySep(
        rule(this.SELECTOR),
        not(consume(Whitespace)),
      );
    },

    SELECTOR() {
      return or([
        rule(this.SELECTOR_CLASS),
        rule(this.SELECTOR_ID),
        rule(this.SELECTOR_TAG),
        rule(this.SELECTOR_ATTRIBUTE),
        rule(this.SELECTOR_PSEUDO),
        consume(Star, () => ({
          type: "selector",
          scope: "all",
        })),
      ]);
    },

    SELECTOR_ATTRIBUTE() {
      return and([
        consume(LSquare),
        consume(StringLiteral),
        zeroOrOne(and([
          zeroOrOne(or([
            consume(Star),
            consume(Tilde),
            consume(Namespace),
            consume(Caret),
            consume(Dolar),
          ])),
          consume(Equal),
          or([
            and([
              consume(QuoteDouble),
              consumeUntil(QuoteDouble),
              consume(QuoteDouble),
            ], ([, value]) => (value || []).join("")),
            and([
              consume(QuoteSingle),
              consumeUntil(QuoteSingle),
              consume(QuoteSingle),
            ], ([, value]) => (value || []).join("")),
            consume(StringLiteral),
          ]),
          zeroOrOne(or([consume(CaseInsensitive), consume(CaseSensitive)])),
        ], ([operator, , value, _case]) => ({
          type: "attribute-value",
          operator,
          value,
          case: _case,
        }))),
        consume(RSquare),
      ], ([, name, value]) => ({
        type: "selector",
        scope: "attribute",
        name,
        value,
      }));
    },

    SELECTOR_PSEUDO() {
      return and([
        consume(Colon),
        zeroOrOne(consume(Colon)),
        consume(StringLiteral),
        zeroOrOne(and([
          consume(LParen),
          zeroOrOne(rule(this.VALUE)),
          consume(RParen),
        ])),
      ], ([, double, name, value]) => ({
        type: "selector",
        scope: "pseudo",
        name,
        value: value?.[1],
        double: !!double,
      }));
    },

    SELECTOR_TAG() {
      return consume(StringLiteral, (name) => ({
        type: "selector",
        scope: "tag",
        name,
      }));
    },

    SELECTOR_ID() {
      return and([
        consume(Hash),
        consume(StringLiteral),
      ], ([, name]) => ({
        type: "selector",
        scope: "id",
        name,
      }));
    },

    SELECTOR_CLASS() {
      return and([
        consume(Dot),
        consume(StringLiteral),
      ], ([, name]) => ({
        type: "selector",
        scope: "class",
        name,
      }));
    },

    /* ------------------------------ Entry + EOF ----------------------------- */
    PROGRAM_EOF() {
      return and([
        rule(this.PROGRAM),
        consume(EOF),
      ], ([program]) => program);
    },
  },
  // Global skip rule: whitespace & line breaks
  () => or([consume(LineBreak), consume(Whitespace)]),
);

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export function parseCss(source: string) {
  return cssParser("PROGRAM_EOF", source);
}

// Backwards compatible exported name
export const parser = parseCss;

/* -------------------------------------------------------------------------- */
/* CLI test                                                                   */
/* -------------------------------------------------------------------------- */
if (import.meta.main) {
  const sample = `
/* simple test */
@media screen and (min-width: 600px) {
  .container { width: 100%; }
}

@keyframes fade {
  from { opacity: 0; }
  50% { opacity: 0.5; }
  to { opacity: 1; }
}

button.primary, button .icon:hover {
  color: #ff00ff;
  padding: 10px;
  animation: fade 2s;
}
`.trim();

  console.log(JSON.stringify(parseCss(sample), null, 2));
}
