// deno-lint-ignore-file ban-unused-ignore no-explicit-any no-unused-vars
import {
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
  Whitespace,
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

  patternToSkip(or([
    consume(Whitespace),
  ]));

  const cache: Record<string, any> = {};

  function Json() {
    return (cache._z1 ||= or(cache._z2 ||= [OBJECT, ARRAY]))();
  }

  function OBJECT() {
    return (cache._a1 ||= and(
      cache._a2 ||= [
        consume(LCurly),
        zeroOrManySep(OBJECT_ITEM, consume(Comma)),
        consume(RCurly),
      ],
      transform,
    ))();

    function transform([_, params]: any) {
      return Object.fromEntries(params || []);
    }
  }

  function OBJECT_ITEM() {
    return (cache._b1 ||= and(
      cache._b2 ||= [consume(StringLiteral, JSON.parse), consume(Colon), VALUE],
      transform,
    ))();

    function transform([name, _, value]: any) {
      return [name, value];
    }
  }

  function ARRAY() {
    return (cache._c1 ||= and(
      cache._c2 ||= [
        consume(LSquare),
        zeroOrManySep(VALUE, consume(Comma)),
        consume(RSquare),
      ],
      transform,
    ))();

    function transform([_, items]: any) {
      return items;
    }
  }

  function VALUE() {
    return (cache._d1 ||= or(
      cache._d2 ||= [
        consume(StringLiteral, JSON.parse),
        consume(NumberLiteral, Number),
        OBJECT,
        ARRAY,
        consume(True, () => true),
        consume(False, () => false),
        consume(Null, () => null),
      ],
    ))();
  }

  const [output] = throwIfError(and([Json, consume(EOF)])) as any;

  return output;
}
