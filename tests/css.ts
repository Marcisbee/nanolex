import {
  createToken,
  EOF,
  getComposedTokens,
  nanolex,
} from "../src/nanolex.ts";

const LineBreak = createToken(/[\n\r]/, "LineBreak");
const Whitespace = createToken(/[ \t]+/, "Whitespace");
const QuoteDouble = createToken(`"`);
const QuoteSingle = createToken(`'`);
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
const Percentage = createToken("%");
const Dot = createToken(".");
const Plus = createToken("+");
const Minus = createToken("-");
const Equal = createToken("=");
const Hex = createToken(/#(?:(?:[0-9a-fA-F]{2}){3}|(?:[0-9a-fA-F]){3})/, "Hex");
const CaseInsensitive = createToken(/[iI]/, "i");
const CaseSensitive = createToken(/[sS]/, "s");
const Hash = createToken("#");
const Star = createToken("*");
const CSSUnits = createToken(
  /em|ex|%|px|cm|mm|in|pt|pc|ch|rem|vh|vw|vmin|vmax|deg/,
);
const CSSTime = createToken(/ms|s|m/);
const Important = createToken("important");
const NumberLiteral = createToken(
  /-?(?:0|[1-9]\d*)?(?:\.\d+)?(?:[eE][+-]?\d+)?/,
  "NumberLiteral",
);
const StringLiteral = createToken(/[a-zA-Z_$][a-zA-Z0-9_$-]*/, "StringLiteral");
const FromTo = createToken(/from|to/);
const Keyframes = createToken("keyframes");
const Media = createToken("media");
const And = createToken("and");
const Or = createToken("or");
const Only = createToken("only");
const Not = createToken("not");

const tokens = getComposedTokens([
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
  Important,
  StringLiteral,
  NumberLiteral,
  CSSUnits,
  CSSTime,
  Plus,
  Minus,
  Equal,
  Dot,
]);

export function parser(value: string) {
  const {
    consume,
    consumeUntil,
    zeroOrOne,
    zeroOrMany,
    zeroOrManySep,
    oneOrManySep,
    and,
    or,
    patternToSkip,
    throwIfError,
    peek,
    not,
  } = nanolex(value, tokens);

  patternToSkip(or([consume(LineBreak), consume(Whitespace)]));

  function TEST(fn: Function) {
    return () => {
      console.log(`>> TEST(${fn.name})`);
      const output = fn();
      console.log({ output });
      console.log(`<< TEST(${fn.name})`);

      return output;
    };
  }

  function SELECTOR_CLASS() {
    return and([consume(Dot), consume(StringLiteral)], ([_, name]) => ({
      type: "selector",
      scope: "class",
      name,
    }))();
  }

  function SELECTOR_ID() {
    return and([consume(Hash), consume(StringLiteral)], ([_, name]) => ({
      type: "selector",
      scope: "id",
      name,
    }))();
  }

  function SELECTOR_TAG() {
    return and([consume(StringLiteral)], ([name]) => ({
      type: "selector",
      scope: "tag",
      name,
    }))();
  }

  function SELECTOR_PSEUDO() {
    return and(
      [
        consume(Colon),
        zeroOrOne(consume(Colon)),
        consume(StringLiteral),
        zeroOrOne(and([consume(LParen), zeroOrOne(VALUE), consume(RParen)])),
      ],
      ([_, double, name, [, value] = []]) => ({
        type: "selector",
        scope: "pseudo",
        name,
        value,
        double: !!double,
      }),
    )();
  }

  function SELECTOR_ATTRIBUTE() {
    return and(
      [
        consume(LSquare),
        consume(StringLiteral),
        zeroOrOne(
          and(
            [
              // https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors#syntax
              zeroOrOne(
                or([
                  consume(Star),
                  consume(Tilde),
                  consume(Namespace),
                  consume(Caret),
                  consume(Dolar),
                ]),
              ),
              consume(Equal),
              or([
                and(
                  [
                    consume(QuoteDouble),
                    consumeUntil(QuoteDouble),
                    consume(QuoteDouble),
                  ],
                  ([, value]) => (value || []).join(""),
                ),
                and(
                  [
                    consume(QuoteSingle),
                    consumeUntil(QuoteSingle),
                    consume(QuoteSingle),
                  ],
                  ([, value]) => (value || []).join(""),
                ),
                consume(StringLiteral),
              ]),
              zeroOrOne(or([consume(CaseInsensitive), consume(CaseSensitive)])),
            ],
            ([operator, , value, _case]) => ({
              type: "attribute-value",
              operator,
              value,
              case: _case,
            }),
          ),
        ),
        consume(RSquare),
      ],
      ([, name, value]) => ({
        type: "selector",
        scope: "attribute",
        name,
        value,
      }),
    )();
  }

  function SELECTOR() {
    return or([
      SELECTOR_CLASS,
      SELECTOR_ID,
      SELECTOR_TAG,
      SELECTOR_ATTRIBUTE,
      SELECTOR_PSEUDO,
      consume(Star, () => ({
        type: "selector",
        scope: "all",
      })),
    ])();
  }

  function SELECTOR_CHAIN() {
    return oneOrManySep(SELECTOR, not(consume(Whitespace)))();
  }

  function SELECTOR_COMBINATOR() {
    return and(
      [
        SELECTOR_CHAIN,
        zeroOrOne(
          and([
            or([
              // Next-sibling combinator
              consume(Plus),
              // Child combinator
              consume(Gt),
              // Column combinator
              and([consume(Namespace), consume(Namespace)]),
              // Subsequent sibling combinator
              consume(Tilde),
              // Descendant combinator
              consume(Whitespace),
            ]),
            SELECTOR_COMBINATOR,
          ]),
        ),
      ],
      ([left, right]) => {
        if (!right) {
          return left;
        }

        return {
          type: "selector",
          scope: "combinator",
          value: [left].concat(right.flat(1)),
        };
      },
    )();
  }

  function SELECTOR_SEPARATOR() {
    return and(
      [
        SELECTOR_COMBINATOR,
        zeroOrOne(and([consume(Namespace), SELECTOR_SEPARATOR])),
      ],
      ([left, right]) => {
        if (!right) {
          return left;
        }

        return {
          type: "selector",
          scope: "separator",
          value: [left].concat(right),
        };
      },
    )();
  }

  function SELECTORS() {
    return oneOrManySep(SELECTOR_SEPARATOR, consume(Comma))();
  }

  function VARIABLE() {
    return and(
      [consume(Minus), consume(Minus), consume(StringLiteral)],
      ([, , name]) => ({
        type: "variable",
        name,
      }),
    )();
  }

  function FUNCTION() {
    return and(
      [
        consume(StringLiteral),
        consume(LParen),
        // @TODO zeroOrManySep(catch, sep, until?)
        // zeroOrManySep(VALUE, consume(Comma), peek(consume(RParen)))
        zeroOrManySep(VALUE, consume(Comma)),
        consume(RParen),
      ],
      ([name, , value]) => ({
        type: "fn",
        value,
        name,
      }),
    )();
  }

  function VALUE() {
    return oneOrManySep(
      or([
        VARIABLE,
        consume(Hex),
        and(
          [consume(NumberLiteral, Number), consume(CSSTime)],
          ([value, unit]) => ({
            type: "time",
            value,
            unit,
          }),
        ),
        and(
          [consume(NumberLiteral, Number), zeroOrOne(consume(CSSUnits))],
          ([value, unit]) => ({
            type: "size",
            value,
            unit,
          }),
        ),
        FUNCTION,
        and(
          [
            consume(QuoteDouble),
            consumeUntil(QuoteDouble),
            consume(QuoteDouble),
          ],
          ([, value]) => ({
            type: "text",
            value: (value || []).join(""),
          }),
        ),
        and(
          [
            consume(QuoteSingle),
            consumeUntil(QuoteSingle),
            consume(QuoteSingle),
          ],
          ([, value]) => ({
            type: "text",
            value: (value || []).join(""),
          }),
        ),
        consume(StringLiteral),
      ]),
      consume(Whitespace),
    )();
  }

  function IMPORTANT_FLAG() {
    return zeroOrOne(
      and([consume(Exclamation), consume(Important)], () => true),
    )();
  }

  function DECLARATION() {
    return and(
      [
        or([
          VARIABLE,
          consume(StringLiteral, (name) => ({
            type: "literal",
            name,
          })),
        ]),
        consume(Colon),
        VALUE,
        IMPORTANT_FLAG,
        or([consume(Semicolon), peek(consume(RCurly))]),
      ],
      ([name, _, value, isImportant]) => ({
        type: "rule",
        name,
        value,
        important: !!isImportant,
      }),
    )();
  }

  function DECLARATIONS_GROUP() {
    return and(
      [consume(LCurly), zeroOrMany(DECLARATION), consume(RCurly)],
      ([_, declarations]) => declarations,
    )();
  }

  function RULESET() {
    return and([SELECTORS, DECLARATIONS_GROUP], ([selectors, rules]) => ({
      type: "ruleset",
      selectors,
      rules,
    }))();
  }

  function KEYFRAMES() {
    return and(
      [
        consume(At),
        consume(Keyframes),
        consume(StringLiteral),
        consume(LCurly),
        zeroOrMany(
          and([
            oneOrManySep(
              or([
                consume(FromTo),
                and(
                  [consume(NumberLiteral), consume(Percentage)],
                  ([value]) => Number(value),
                ),
              ]),
              consume(Comma),
            ),
            DECLARATIONS_GROUP,
          ], ([selectors, rules]) => ({
            type: "frame",
            selectors,
            rules,
          })),
        ),
        consume(RCurly),
      ],
      ([, , name, , ruleset]) => ({
        type: "atrule",
        scope: "keyframes",
        name,
        ruleset,
      }),
    )();
  }

  function MEDIA_FEATURE() {
    return and([
      consume(LParen),
      or([
        and([
          consume(StringLiteral),
          consume(Colon),
          VALUE,
        ], ([name, , value]) => ({
          type: "feature-name",
          name,
          value,
        })),
        consume(StringLiteral, (name) => ({
          type: "feature-name",
          name,
        })),
        // @TODO range
      ]),
      consume(RParen),
    ], ([, value]) => ({
      type: "media-feature",
      value,
    }))();
  }

  function MEDIA_CONDITION() {
    return or([
      MEDIA_FEATURE,
      consume(StringLiteral),
    ])();
  }

  function MEDIA_QUERY() {
    return or([
      and([
        or([
          consume(Only),
          consume(Not),
        ]),
        consume(StringLiteral),
        zeroOrOne(and([
          consume(And),
          MEDIA_CONDITION,
        ], ([scope, value]) => ({
          type: "media-query-condition",
          scope,
          value,
        }))),
      ], ([scope, media_type, condition]) => ({
        type: "media-query",
        scope,
        media_type,
        condition,
      })),
      MEDIA_CONDITION,
    ])();
  }

  function MEDIA_QUERIES() {
    return oneOrManySep(
      MEDIA_QUERY,
      consume(Comma),
    )();
  }

  function MEDIA() {
    return and(
      [
        consume(At),
        consume(Media),
        MEDIA_QUERIES,
        consume(LCurly),
        zeroOrMany(RULESET),
        consume(RCurly),
      ],
      ([, , query, , ruleset]) => ({
        type: "atrule",
        scope: "media",
        query,
        ruleset,
      }),
    )();
  }

  function PROGRAM() {
    return zeroOrMany(or([RULESET, KEYFRAMES, MEDIA]))();
  }

  const [output] = throwIfError(and([PROGRAM, consume(EOF)]));

  return output;
}
