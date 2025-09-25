// deno-lint-ignore-file ban-unused-ignore no-explicit-any no-unused-vars ban-types
import {
  createPattern,
  createToken,
  EOF,
  getComposedTokens,
  nanolex,
} from "../src/nanolex.ts";

const Whitespace = createToken(/[ \t\n\r]+/, "WhiteSpace");
const True = createToken("true");
const False = createToken("false");
const Null = createToken("null");
const LCurly = createToken("{");
const RCurly = createToken("}");
const LSquare = createToken("[");
const RSquare = createToken("]");
const Colon = createToken(":");
const Comma = createToken(",");
const StringLiteral = createToken(
  /"(?:[^\\"]|\\(?:[bfnrtv"\\/]|u[0-9a-fA-F]{4}))*"/,
  "StringLiteral",
);
const NumberLiteral = createToken(
  /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
  "NumberLiteral",
);

const tokens = getComposedTokens([
  StringLiteral,
  NumberLiteral,
  Comma,
  Colon,
  LCurly,
  RCurly,
  LSquare,
  RSquare,
  True,
  False,
  Null,
]);

const LE_JSON = createPattern("json");
const OBJECT = createPattern<Record<string, any>>("object");
const OBJECT_ITEM = createPattern<[string, any]>("objectItem");
const ARRAY = createPattern<any[]>("array");
const VALUE = createPattern<any>("value");

export function parser(value: string) {
  const {
    consume,
    zeroOrOne,
    zeroOrMany,
    zeroOrManySep,
    and,
    or,
    patternToSkip,
    throwIfError,
  } = nanolex(value, tokens);

  patternToSkip(consume(Whitespace));

  LE_JSON.set = or([OBJECT, ARRAY]);

  OBJECT.set = and([
    consume(LCurly),
    zeroOrManySep(OBJECT_ITEM, consume(Comma)),
    consume(RCurly),
  ], ([_, params]) => Object.fromEntries(params || []));

  OBJECT_ITEM.set = and([
    consume(StringLiteral, (value) => value.slice(1, -1)),
    consume(Colon),
    VALUE,
  ], ([name, _, value]) => [name, value]);

  ARRAY.set = and([
    consume(LSquare),
    zeroOrManySep(VALUE, consume(Comma)),
    consume(RSquare),
  ], ([_, items]) => items);

  VALUE.set = or([
    consume(StringLiteral, (value) => value.slice(1, -1)),
    consume(NumberLiteral, Number),
    OBJECT,
    ARRAY,
    consume(True, () => true),
    consume(False, () => false),
    consume(Null, () => null),
  ]);

  const [output] = throwIfError(and([LE_JSON, consume(EOF)]));

  return output;
}
