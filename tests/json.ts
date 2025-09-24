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

const $json = createPattern("json");
const $object = createPattern<Record<string, any>>("object");
const $objectItem = createPattern<[string, any]>("objectItem");
const $array = createPattern<any[]>("array");
const $value = createPattern<any>("value");

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

  $json.set = or([$object, $array]);

  $object.set = and([
    consume(LCurly),
    zeroOrManySep($objectItem, consume(Comma)),
    consume(RCurly),
  ], ([_, params]) => Object.fromEntries(params || []));

  $objectItem.set = and([
    consume(StringLiteral, (value) => value.slice(1, -1)),
    consume(Colon),
    $value,
  ], ([name, _, value]) => [name, value]);

  $array.set = and([
    consume(LSquare),
    zeroOrManySep($value, consume(Comma)),
    consume(RSquare),
  ], ([_, items]) => items);

  $value.set = or([
    consume(StringLiteral, (value) => value.slice(1, -1)),
    consume(NumberLiteral, Number),
    $object,
    $array,
    consume(True, () => true),
    consume(False, () => false),
    consume(Null, () => null),
  ]);

  const [output] = throwIfError(and([$json, consume(EOF)]));

  return output;
}
