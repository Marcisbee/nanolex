/**
 * JSON parser implemented with the nanolex3 combinator API.
 * Supports objects, arrays, strings, numbers, booleans, and null.
 */
import {
  and,
  consume,
  createParser,
  createToken,
  EOF,
  or,
  rule,
  skipIn,
  zeroOrManySep,
} from "../src/nanolex.ts";

/* -------------------------------- Tokens -------------------------------- */

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

/**
 * Order matters for token splitting (earlier tokens have priority).
 */
const tokens = [
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
];

/* ------------------------------- Grammar ---------------------------------- */
/**
 * createParser returns a function we can invoke with any rule name + input.
 * We pass a global skip factory to automatically skip whitespace everywhere.
 */
const jsonParser = createParser(
  tokens,
  {
    JSON() {
      return or([
        rule(this.OBJECT),
        rule(this.ARRAY),
      ]);
    },

    OBJECT() {
      return and([
        consume(LCurly),
        zeroOrManySep(rule(this.OBJECT_ITEM), consume(Comma)),
        consume(RCurly),
      ], ([_l, entries]) => {
        return Object.fromEntries(entries || []);
      });
    },

    OBJECT_ITEM() {
      return and([
        consume(StringLiteral, (v) => v.slice(1, -1)),
        consume(Colon),
        rule(this.VALUE),
      ], ([key, _c, value]) => [key, value] as [string, any]);
    },

    ARRAY() {
      return and([
        consume(LSquare),
        zeroOrManySep(rule(this.VALUE), consume(Comma)),
        consume(RSquare),
      ], ([_l, items]) => items);
    },

    VALUE() {
      return or([
        consume(StringLiteral, (v) => v.slice(1, -1)),
        consume(NumberLiteral, Number),
        rule(this.OBJECT),
        rule(this.ARRAY),
        consume(True, () => true),
        consume(False, () => false),
        consume(Null, () => null),
      ]);
    },

    PROGRAM() {
      // Apply whitespace skipping only within the top-level rule
      return skipIn(consume(Whitespace), rule(this.JSON));
    },
  },
  // Optionally, we could pass a global skip with: () => consume(Whitespace)
);

/* ------------------------------ Public API -------------------------------- */

/**
 * Parse a JSON string into a native JS value.
 * @param value JSON text
 */
export function parseJson(value: string): any {
  return jsonParser("PROGRAM", value);
}

/**
 * Backwards-compatible exported name (optional).
 */
export const parser = parseJson;

/* ------------------------------- CLI Demo --------------------------------- */
if (import.meta.main) {
  const sample = `{
    "name": "Example",
    "nums": [1, 2, 3],
    "nested": { "ok": true, "n": null, "v": -12.5e2 }
  }`;
  console.log(parseJson(sample));
}
