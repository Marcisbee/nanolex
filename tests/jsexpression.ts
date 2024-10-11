import {
  createToken,
  EOF,
  getComposedTokens,
  nanolex,
} from "../src/nanolex.ts";

const Whitespace = createToken(/[ \t\n\r]+/, "WhiteSpace");
const OperatorPlus = createToken("+");
const Integer = createToken(/-?\d+/, "Integer");

const tokens = getComposedTokens([Whitespace, OperatorPlus, Integer]);

export function parser(value: string) {
  const {
    consume,
    zeroOrOne,
    zeroOrMany,
    zeroOrManySep,
    and,
    or,
    breakLoop,
    patternToSkip,
    throwIfError,
  } = nanolex(value, tokens);

  patternToSkip(or([
    consume(Whitespace),
  ]));

  function BinaryExpression() {
    return and(
      [
        breakLoop(0, Expression),
        consume(OperatorPlus),
        Expression,
      ],
      transform,
    )();

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
    return or([consume(Integer)], transform)();

    function transform(raw: any) {
      return {
        type: "Literal",
        raw,
      };
    }
  }

  function Expression() {
    return or([BinaryExpression, Literal])();
  }

  const [output] = throwIfError(and([Expression, consume(EOF)]));

  return output;
}
