// deno-lint-ignore-file ban-unused-ignore no-explicit-any no-unused-vars ban-types
import {
  createPattern,
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

const PROGRAM = createPattern<any[]>("program");
const RULESET = createPattern<any>("ruleset");
const KEYFRAMES = createPattern<any>("keyframes");
const MEDIA = createPattern<any>("media");
const MEDIA_QUERIES = createPattern<any[]>("mediaQueries");
const MEDIA_QUERY = createPattern<any>("mediaQuery");
const MEDIA_CONDITION = createPattern<any>("mediaCondition");
const MEDIA_FEATURE = createPattern<any>("mediaFeature");
const DECLARATIONS_GROUP = createPattern<any[]>("declarationsGroup");
const DECLARATION = createPattern<any>("declaration");
const IMPORTANT_FLAG = createPattern<boolean>("importantFlag");
const VALUE = createPattern<any>("value");
const FUNCTION = createPattern<any>("function");
const VARIABLE = createPattern<any>("variable");
const SELECTORS = createPattern<any[]>("selectors");
const SELECTOR_SEPARATOR = createPattern<any>("selectorSeparator");
const SELECTOR_COMBINATOR = createPattern<any>("selectorCombinator");
const SELECTOR_CHAIN = createPattern<any[]>("selectorChain");
const SELECTOR = createPattern<any>("selector");
const SELECTOR_ATTRIBUTE = createPattern<any>("selectorAttribute");
const SELECTOR_PSEUDO = createPattern<any>("selectorPseudo");
const SELECTOR_TAG = createPattern<any>("selectorTag");
const SELECTOR_ID = createPattern<any>("selectorId");
const SELECTOR_CLASS = createPattern<any>("selectorClass");

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

  PROGRAM.set = zeroOrMany(or([RULESET, KEYFRAMES, MEDIA]));

  RULESET.set = and([SELECTORS, DECLARATIONS_GROUP], ([selectors, rules]) => ({
    type: "ruleset",
    selectors,
    rules,
  }));

  KEYFRAMES.set = and(
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
  );

  MEDIA.set = and(
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
  );

  MEDIA_QUERIES.set = oneOrManySep(
    MEDIA_QUERY,
    consume(Comma),
  );

  MEDIA_QUERY.set = or([
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
  ]);

  MEDIA_CONDITION.set = or([
    MEDIA_FEATURE,
    consume(StringLiteral),
  ]);

  MEDIA_FEATURE.set = and([
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
  }));

  DECLARATIONS_GROUP.set = and(
    [consume(LCurly), zeroOrMany(DECLARATION), consume(RCurly)],
    ([_, declarations]) => declarations,
  );

  DECLARATION.set = and(
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
  );

  IMPORTANT_FLAG.set = zeroOrOne(
    and([consume(Exclamation), consume(Important)], () => true),
  );

  VALUE.set = oneOrManySep(
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
  );

  FUNCTION.set = and(
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
  );

  VARIABLE.set = and(
    [consume(Minus), consume(Minus), consume(StringLiteral)],
    ([, , name]) => ({
      type: "variable",
      name,
    }),
  );

  SELECTORS.set = oneOrManySep(SELECTOR_SEPARATOR, consume(Comma));

  SELECTOR_SEPARATOR.set = and(
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
  );

  SELECTOR_COMBINATOR.set = and(
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
  );

  SELECTOR_CHAIN.set = oneOrManySep(SELECTOR, not(consume(Whitespace)));

  SELECTOR.set = or([
    SELECTOR_CLASS,
    SELECTOR_ID,
    SELECTOR_TAG,
    SELECTOR_ATTRIBUTE,
    SELECTOR_PSEUDO,
    consume(Star, () => ({
      type: "selector",
      scope: "all",
    })),
  ]);

  SELECTOR_ATTRIBUTE.set = and(
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
  );

  SELECTOR_PSEUDO.set = and(
    [
      consume(Colon),
      zeroOrOne(consume(Colon)),
      consume(StringLiteral),
      zeroOrOne(and([consume(LParen), zeroOrOne(VALUE), consume(RParen)])),
    ],
    ([_, double, name, value]) => ({
      type: "selector",
      scope: "pseudo",
      name,
      value: value?.[1],
      double: !!double,
    }),
  );

  SELECTOR_TAG.set = and([consume(StringLiteral)], ([name]) => ({
    type: "selector",
    scope: "tag",
    name,
  }));

  SELECTOR_ID.set = and(
    [consume(Hash), consume(StringLiteral)],
    ([_, name]) => ({
      type: "selector",
      scope: "id",
      name,
    }),
  );

  SELECTOR_CLASS.set = and(
    [consume(Dot), consume(StringLiteral)],
    ([_, name]) => ({
      type: "selector",
      scope: "class",
      name,
    }),
  );

  const [output] = throwIfError(and([PROGRAM, consume(EOF)]));

  return output;
}
