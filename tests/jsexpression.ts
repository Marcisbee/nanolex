import {
  and,
  consume,
  createParser,
  createToken,
  EOF,
  rule,
  zeroOrMany,
} from "../src/nanolex.ts";

/* -------------------------------------------------------------------------- */
/* Tokens                                                                     */
/* -------------------------------------------------------------------------- */

const Whitespace = createToken(/[ \t\n\r]+/, "Whitespace");
const Plus = createToken("+", "Plus");
const Integer = createToken(/-?\d+/, "Integer");

/**
 * Order matters: listed tokens form the splitting regex alternation.
 * Whitespace included so we can globally skip it with a skip rule.
 */
const tokens = [
  Whitespace,
  Plus,
  Integer,
];

/* -------------------------------------------------------------------------- */
/* AST Types                                                                  */
/* -------------------------------------------------------------------------- */

export interface Literal {
  type: "Literal";
  raw: string;
}

export interface BinaryExpression {
  type: "BinaryExpression";
  operator: string;
  left: ASTNode;
  right: ASTNode;
}

export type ASTNode = Literal | BinaryExpression;

/* -------------------------------------------------------------------------- */
/* Parser Construction                                                        */
/* -------------------------------------------------------------------------- */

const expressionParser = createParser(
  tokens,
  {
    /**
     * PROGRAM -> EXPRESSION EOF
     */
    PROGRAM() {
      return and([
        rule(this.EXPRESSION),
        consume(EOF),
      ], ([expr]) => expr);
    },

    /**
     * EXPRESSION -> PRIMARY ( '+' PRIMARY )*
     * Build left-associative tree by folding the tail list.
     */
    EXPRESSION() {
      return and([
        rule(this.PRIMARY),
        zeroOrMany(and([
          consume(Plus),
          rule(this.PRIMARY),
        ])),
      ], ([first, rest]) => {
        // Build a right-associative tree: a + b + c => a + (b + c)
        if (rest.length === 0) {
          return first;
        }

        function build(i: number): ASTNode {
          const [op, right] = rest[i];
          const rightNode = i === rest.length - 1 ? right : build(i + 1);
          const leftNode: ASTNode = i === 0 ? first : rest[i - 1][1];
          return {
            type: "BinaryExpression",
            operator: op,
            left: leftNode,
            right: rightNode,
          };
        }

        return build(0);
      });
    },

    /**
     * PRIMARY -> Integer
     */
    PRIMARY() {
      return consume(Integer, (raw): Literal => ({
        type: "Literal",
        raw,
      }));
    },
  },
  // Global skip rule: ignore all whitespace everywhere.
  () => consume(Whitespace),
);

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Parse an arithmetic expression containing + operations and integers.
 * @param input Expression source text
 */
export function parser(input: string): ASTNode {
  return expressionParser("PROGRAM", input);
}

/* -------------------------------------------------------------------------- */
/* CLI / Manual Test                                                          */
/* -------------------------------------------------------------------------- */

if (import.meta.main) {
  const samples = [
    "1",
    "1+2",
    "1 + 2 + 3",
    "10+20+30+40",
    "-5 + 6 + 7",
  ];
  for (const s of samples) {
    console.log(s, "=>", JSON.stringify(parser(s), null, 2));
  }
}
