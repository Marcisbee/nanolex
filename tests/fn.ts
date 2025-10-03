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

// Define tokens
const Whitespace = createToken(/[ \t\n\r]+/, "Whitespace");
const LParen = createToken("(");
const RParen = createToken(")");
const Comma = createToken(",");
const Integer = createToken(/-?\d+/, "Integer");
const Identifier = createToken(/\w+/, "Identifier");

// Combine tokens
const tokens = [
  Whitespace,
  LParen,
  RParen,
  Comma,
  Integer,
  Identifier,
];

const jsonParser = createParser(
  tokens,
  {
    FUNCTION() {
      return and([
        consume(Identifier),
        consume(LParen),
        rule(this.PARAMS),
        consume(RParen),
      ], ([name, _lparen, params, _rparen]) => ({
        type: "function",
        name,
        params,
      }));
    },

    PARAMS() {
      return zeroOrManySep(rule(this.VALUE), consume(Comma));
    },

    VALUE() {
      return or([
        consume(Integer, Number),
        rule(this.FUNCTION),
      ]);
    },

    PROGRAM() {
      return skipIn(consume(Whitespace), rule(this.FUNCTION));
    },
  },
);

export function parser(value: string) {
  return jsonParser("PROGRAM", value);
}

if (import.meta.main) {
  console.log(parser("add(1,2,mul(3,4))"));
  console.log(parser("add(555)"));
}
