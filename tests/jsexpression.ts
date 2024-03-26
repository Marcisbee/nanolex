import { createToken, framework, getComposedTokens } from "../src/nanolex.ts";

const Whitespace = createToken(/[ \t\n\r]+/, "WhiteSpace", /* skip */ true);
const OperatorPlus = createToken("+");
const Integer = createToken(/-?\d+/, "Integer");

const tokens = getComposedTokens([
  Whitespace,
  OperatorPlus,
  Integer,
]);

export function parser(value: string) {
  const {
    consume,
    consumeEOF,
    zeroOrOne,
    zeroOrMany,
    zeroOrManySep,
    and,
    or,
    throwIfError,
  } = framework(value, tokens);

  function BinaryExpression() {
    return and([
      Expression,
      // Literal,
      consume(OperatorPlus),
      Expression,
    ], transform, 2)();

    function transform([left, operator, right]: any) {
      return {
        type: "BinaryExpression",
        operator,
        left,
        right,
      };
    }
  }

  function Literal() {
    return or([
      consume(Integer),
      //consume(Integer, Number),
      // BinaryExpression,
    ], transform)();

    function transform(raw: any) {
      return {
        type: "Literal",
        raw,
      };
    }
  }

  function Expression() {
    return or([
      BinaryExpression,
      Literal,
    ])();
  }

  const [output] = throwIfError(and([Expression, consumeEOF()]));

  return output;
}
