// deno-lint-ignore-file no-explicit-any
import {
  and,
  consume,
  consumeAny,
  consumeUntil,
  createParser,
  createToken,
  EOF,
  type Grammar,
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
const Comment = createToken(/\/\*[\s\S]*?\*\//, "Comment");
const StringDouble = createToken(/"(?:\\[\s\S]|[^"\\])*"/, "StringDouble");
const StringSingle = createToken(/'(?:\\[\s\S]|[^'\\])*'/, "StringSingle");
const Url = createToken(
  /url\(\s*(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|(?:\\.|[^\\()"'\s])*)\s*\)/,
  "Url",
);
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
const Slash = createToken("/");
const Ampersand = createToken("&");
const Question = createToken("?");
const Important = createToken("important");
// CSS tokenization treats colors and ID-like values as the same hash token.
// Semantic validation (for example, valid hex-color lengths) belongs downstream.
const Hex = createToken(
  /#(?:[_a-zA-Z0-9-]|[^\0-\x7f]|\\[^\r\n\f])+/,
  "Hash",
);
const CaseInsensitive = createToken(/[iI]/, "i");
const CaseSensitive = createToken(/[sS]/, "s");
const CSSUnits = createToken(
  /cap|ch|cm|cqb|cqh|cqi|cqmax|cqmin|cqw|deg|dpcm|dpi|dppx|dvh|dvw|em|ex|fr|grad|Hz|ic|in|kHz|lh|lvh|lvw|mm|ms|pc|pt|px|Q|rad|rcap|rch|rem|rex|ric|rlh|s|svh|svw|turn|vb|vh|vi|vmax|vmin|vw|x|%/,
  "Unit",
);
const CSSTime = createToken(/ms|s/, "Time");
const NumberLiteral = createToken(
  /-?(?:(?:\d*\.\d+)|(?:\d+\.?))(?:[eE][+-]?\d+)?/,
  "NumberLiteral",
);
const CustomProperty = createToken(
  /--(?:[_a-zA-Z]|[^\0-\x7f]|\\[^\r\n\f])(?:[_a-zA-Z0-9-]|[^\0-\x7f]|\\[^\r\n\f])*/,
  "CustomProperty",
);
const StringLiteral = createToken(
  /-?(?:[_a-zA-Z]|[^\0-\x7f]|\\[0-9a-fA-F]{1,6}[ \t\r\n\f]?|\\[^\r\n\f0-9a-fA-F])(?:[_a-zA-Z0-9-]|[^\0-\x7f]|\\[0-9a-fA-F]{1,6}[ \t\r\n\f]?|\\[^\r\n\f0-9a-fA-F])*/,
  "Ident",
);
const FromTo = createToken(/from|to/, "FromTo");
const Keyframes = createToken(/(?:-(?:webkit|moz)-)?keyframes/, "keyframes");
const Media = createToken("media");
const And = createToken("and");
const OrToken = createToken("or");
const Only = createToken("only");
const Not = createToken("not");

/**
 * Order intentionally groups structural tokens early; identifiers & numbers later.
 */
const tokens = [
  Comment,
  Url,
  StringDouble,
  StringSingle,
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
  Slash,
  Ampersand,
  Question,
  Important,
  CustomProperty,
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

function decodeCssString(value: string): string {
  return value.slice(1, -1)
    .replace(/\\(?:\r\n|[\n\r\f])/g, "")
    .replace(
      /\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?|\\(.)/gs,
      (_, hex: string | undefined, escaped: string | undefined) =>
        hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : escaped ?? "",
    );
}

function parseUrl(value: string) {
  const raw = value.slice(value.indexOf("(") + 1, -1).trim();
  return {
    type: "url",
    value: raw.startsWith(`"`) || raw.startsWith(`'`)
      ? decodeCssString(raw)
      : raw.replace(/\\(.)/gs, "$1"),
  };
}

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
        rule(this.AT_RULE),
      ]));
    },

    /* --------------------------- Generic at-rules --------------------------- */
    AT_RULE(): Grammar<any> {
      return and([
        consume(At),
        consume(StringLiteral),
        consumeUntil(
          or([peek(consume(Semicolon)), peek(consume(LCurly))]),
          (parts) => parts.join("").trim(),
        ),
        or([
          consume(Semicolon, () => undefined),
          and([
            consume(LCurly),
            zeroOrMany(or([
              rule(this.AT_RULE),
              rule(this.RULESET),
              rule(this.DECLARATION),
            ])),
            consume(RCurly),
          ], ([, body]) => body),
        ]),
      ], ([, name, prelude, body]) => ({
        type: "atrule",
        scope: name.toLowerCase(),
        prelude,
        ruleset: body,
      }));
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
        zeroOrMany(or([rule(this.RULESET), rule(this.AT_RULE)])),
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
    DECLARATIONS_GROUP(): Grammar<any[]> {
      return and([
        consume(LCurly),
        zeroOrMany(or([
          rule(this.DECLARATION),
          rule(this.AT_RULE),
          rule(this.RULESET),
        ])),
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
    VALUE(): Grammar<any> {
      return and([
        rule(this.VALUE_SEQUENCE),
        zeroOrMany(and([
          consume(Comma),
          rule(this.VALUE_SEQUENCE),
        ])),
      ], ([first, rest]) =>
        rest.reduce(
          (values, [, next]) => values.concat(",", next),
          first,
        ));
    },

    VALUE_SEQUENCE(): Grammar<any[]> {
      return oneOrManySep(
        rule(this.VALUE_COMPONENT),
        or([consume(Whitespace), consume(LineBreak), consume(Comment)]),
      );
    },

    VALUE_COMPONENT(): Grammar<any> {
      return or([
        rule(this.VARIABLE),
        consume(Hex),
        consume(Url, parseUrl),
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
          consume(CSSUnits),
        ], ([value, unit]) => ({
          type: "size",
          value,
          unit,
        })),
        and([
          consume(NumberLiteral, Number),
          consume(StringLiteral),
        ], ([value, unit]) => ({
          type: "dimension",
          value,
          unit,
        })),
        consume(NumberLiteral, (value) => ({
          type: "size",
          value: Number(value),
          unit: undefined,
        })),
        rule(this.FUNCTION),
        consume(StringDouble, (value) => ({
          type: "text",
          value: decodeCssString(value),
        })),
        consume(StringSingle, (value) => ({
          type: "text",
          value: decodeCssString(value),
        })),
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
        or([
          consume(Slash),
          consume(Plus),
          consume(Minus),
          consume(Star),
          consume(Dot),
          consume(Colon),
          consume(Question),
          consume(Ampersand),
          consume(Equal),
        ]),
      ]);
    },

    FUNCTION() {
      return and([
        consume(StringLiteral),
        consume(LParen),
        zeroOrManySep(rule(this.VALUE_SEQUENCE), consume(Comma)),
        consume(RParen),
      ], ([name, , value]) => ({
        type: "fn",
        name,
        value,
      }));
    },

    VARIABLE(): Grammar<any> {
      return or([
        consume(CustomProperty, (name) => ({
          type: "variable",
          name: name.slice(2),
        })),
        and([
          consume(Minus),
          consume(Minus),
          consume(StringLiteral),
        ], ([, , name]) => ({
          type: "variable",
          name,
        })),
      ]);
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

    SELECTOR_SEPARATOR(): Grammar<any> {
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

    SELECTOR_COMBINATOR(): Grammar<any> {
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
        consume(Ampersand, () => ({
          type: "selector",
          scope: "nesting",
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
            consume(StringDouble, decodeCssString),
            consume(StringSingle, decodeCssString),
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
          rule(this.PSEUDO_ARGUMENT),
          consume(RParen),
        ])),
      ], ([, double, name, value]) => ({
        type: "selector",
        scope: "pseudo",
        name,
        value: value?.[1] || undefined,
        double: !!double,
      }));
    },

    PSEUDO_ARGUMENT(): Grammar<string> {
      return zeroOrMany(or([
        and([
          consume(LParen),
          rule(this.PSEUDO_ARGUMENT),
          consume(RParen),
        ], ([, value]) => `(${value})`),
        and([
          not(peek(consume(RParen))),
          consumeAny(),
        ], ([, value]) => value),
      ]), (parts) => parts.join("").trim());
    },

    SELECTOR_TAG() {
      return consume(StringLiteral, (name) => ({
        type: "selector",
        scope: "tag",
        name,
      }));
    },

    SELECTOR_ID() {
      return or([
        and([
          consume(Hash),
          consume(StringLiteral),
        ], ([, name]) => ({
          type: "selector",
          scope: "id",
          name,
        })),
        consume(Hex, (name) => ({
          type: "selector",
          scope: "id",
          name: name.slice(1),
        })),
      ]);
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
  // Global skip rule: comments, whitespace, and line breaks
  () => or([consume(Comment), consume(LineBreak), consume(Whitespace)]),
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
