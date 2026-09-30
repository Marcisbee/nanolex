import { strict as assert } from "node:assert";
import {
  and,
  compile,
  consume,
  consumeAny,
  type Context,
  createParser,
  createToken,
  dispatch,
  EOF,
  fold,
  type Grammar,
  INFINITE_LOOP,
  map,
  not,
  or,
  peek,
  rule,
  skipIn,
  UNEXPECTED,
  zeroOrMany,
  zeroOrOne,
} from "../src/nanolex.ts";

const A = createToken("a"), B = createToken("b"), C = createToken("c");
const context = (tokens: string[]): Context => ({
  input: tokens.join(""),
  tokens,
  pos: 0,
  skipRule: null,
});

Deno.test("compiled combinators preserve values, errors, progress and rollback", () => {
  const movingFailure: Grammar<never> = (ctx) => [++ctx.pos, C];
  const opaqueRules: Grammar<unknown>[] = [];
  opaqueRules.push(function (this: unknown, ctx) {
    ctx.pos++;
    return [this === opaqueRules, null];
  });
  const cases: {
    name: string;
    grammar: Grammar<unknown>;
    tokens: string[];
    result: unknown;
    pos: number;
  }[] = [
    {
      name: "sequence",
      grammar: and([consume(A), consume(B)], (xs) => xs.join("")),
      tokens: ["a", "b"],
      result: ["ab", null],
      pos: 2,
    },
    {
      name: "empty sequence",
      grammar: and([]),
      tokens: [],
      result: [[], null],
      pos: 0,
    },
    {
      name: "sequence rollback",
      grammar: and([consume(A), movingFailure]),
      tokens: ["a", "b"],
      result: [2, C],
      pos: 0,
    },
    {
      name: "alternative rollback",
      grammar: or([
        and([consume(A), consume(C)]),
        and([consume(A), consume(B)]),
      ]),
      tokens: ["a", "b"],
      result: [["a", "b"], null],
      pos: 2,
    },
    {
      name: "last alternative error",
      grammar: or([consume(A), movingFailure]),
      tokens: ["b"],
      result: [1, C],
      pos: 0,
    },
    {
      name: "empty alternatives",
      grammar: or([]),
      tokens: [],
      result: [0, EOF],
      pos: 0,
    },
    {
      name: "optional absent",
      grammar: zeroOrOne(movingFailure),
      tokens: ["b"],
      result: [undefined, null],
      pos: 0,
    },
    {
      name: "optional transform",
      grammar: zeroOrOne(consume(A), () => 7),
      tokens: ["a"],
      result: [7, null],
      pos: 1,
    },
    {
      name: "peek",
      grammar: peek(and([consume(A), consume(B)])),
      tokens: ["a", "b"],
      result: [["a", "b"], null],
      pos: 0,
    },
    {
      name: "peek failure",
      grammar: peek(movingFailure),
      tokens: ["a"],
      result: [1, C],
      pos: 0,
    },
    {
      name: "negative lookahead",
      grammar: not(movingFailure),
      tokens: ["a"],
      result: [null, null],
      pos: 0,
    },
    {
      name: "negative failure",
      grammar: not(consume(A)),
      tokens: ["a"],
      result: [0, UNEXPECTED],
      pos: 0,
    },
    {
      name: "repeat with until",
      grammar: zeroOrMany(consumeAny(), (xs) => xs.join(""), consume(B)),
      tokens: ["a", "a", "b"],
      result: ["aa", null],
      pos: 2,
    },
    {
      name: "repeat rollback",
      grammar: zeroOrMany(and([consume(A), consume(B)])),
      tokens: ["a", "b", "a", "c"],
      result: [[["a", "b"]], null],
      pos: 2,
    },
    {
      name: "repeat progress",
      grammar: zeroOrMany(and([])),
      tokens: [],
      result: [0, INFINITE_LOOP],
      pos: 0,
    },
    {
      name: "fold",
      grammar: fold(consume(A), consume(B), (a, b) => a + b),
      tokens: ["a", "b", "b", "c"],
      result: ["abb", null],
      pos: 3,
    },
    {
      name: "fold progress",
      grammar: fold(consume(A), and([]), (a) => a),
      tokens: ["a"],
      result: [1, INFINITE_LOOP],
      pos: 0,
    },
    {
      name: "fold initial failure",
      grammar: fold(movingFailure, consume(B), () => 0 as never),
      tokens: ["b"],
      result: [1, C],
      pos: 0,
    },
    {
      name: "mapped position",
      grammar: map(consume(A), (v, ctx, start) => [v, start, ctx.pos]),
      tokens: ["a"],
      result: [["a", 0, 1], null],
      pos: 1,
    },
    {
      name: "dispatch failure restores",
      grammar: dispatch(consumeAny(), { a: movingFailure }, consume(A)),
      tokens: ["a"],
      result: [1, C],
      pos: 0,
    },
    {
      name: "dispatch selector failure",
      grammar: dispatch(movingFailure, {}, consume(A)),
      tokens: ["a"],
      result: [1, C],
      pos: 0,
    },
    {
      name: "dispatch unknown",
      grammar: dispatch(consumeAny(), { a: consume(A) }),
      tokens: ["b"],
      result: [0, UNEXPECTED],
      pos: 0,
    },
    {
      name: "dispatch undefined own branch",
      grammar: dispatch(consumeAny(), { a: undefined }, consume(A)),
      tokens: ["a"],
      result: [0, UNEXPECTED],
      pos: 0,
    },
    {
      name: "prototype key is not a branch",
      grammar: dispatch(consumeAny(), {}, consumeAny()),
      tokens: ["constructor"],
      result: ["constructor", null],
      pos: 1,
    },
    {
      name: "computed prototype branch",
      grammar: dispatch(consumeAny(), {
        ["__proto__"]: consumeAny((v) => v.length),
      }),
      tokens: ["__proto__"],
      result: [9, null],
      pos: 1,
    },
    {
      name: "EOF with empty chunks",
      grammar: and([consumeAny(), consume(EOF)]),
      tokens: ["", "a", ""],
      result: [["a", ""], null],
      pos: 3,
    },
    {
      name: "scoped trivia",
      grammar: skipIn(consume(createToken(" ")), consume(A)),
      tokens: [" ", "a", " "],
      result: ["a", null],
      pos: 3,
    },
    {
      name: "scoped trivia failure",
      grammar: skipIn(consume(createToken(" ")), consume(A)),
      tokens: [" ", "b"],
      result: [1, A],
      pos: 1,
    },
    {
      name: "transform receiver",
      grammar: consume(A, function (this: unknown) {
        return this;
      }),
      tokens: ["a"],
      result: [undefined, null],
      pos: 1,
    },
    {
      name: "opaque rule receiver",
      grammar: and(opaqueRules),
      tokens: ["a"],
      result: [[true], null],
      pos: 1,
    },
  ];
  for (const item of cases) {
    for (const optimized of [false, true]) {
      const ctx = context(item.tokens);
      const grammar = optimized ? compile(item.grammar) : item.grammar;
      assert.deepEqual(
        grammar(ctx),
        item.result,
        `${item.name}; compiled=${optimized}`,
      );
      assert.equal(ctx.pos, item.pos, item.name);
    }
  }
});

Deno.test("compiled recursive grammars preserve trivia and nested transformations", () => {
  const number = createToken(/\d+/),
    plus = createToken("+"),
    open = createToken("("),
    close = createToken(")"),
    space = createToken(/\s+/);
  for (const optimized of [false, true]) {
    const parser = createParser(
      [number, plus, open, close, space],
      {
        VALUE(): Grammar<number> {
          return or([
            consume(number, Number),
            and(
              [consume(open), rule(this.SUM), consume(close)],
              ([, value]) => value,
            ),
          ]);
        },
        SUM(): Grammar<number> {
          return fold(
            rule(this.VALUE),
            and([consume(plus), rule(this.VALUE)], ([, value]) => value),
            (a, b) => a + b,
          );
        },
        RAW(): Grammar<string> {
          return consumeAny();
        },
      },
      () => consume(space),
      { compile: optimized },
    );
    assert.equal(parser("SUM", " 1 + ( 2 + 3 ) + 4 "), 10);
    assert.equal(parser("SUM", "5"), 5);
    assert.equal(parser("RAW", " "), " ");
    assert.throws(() => parser("SUM", "1 + (2 + )"), /Parse error/);
  }
});

Deno.test("compiled transforms may re-enter the parser and tokens remain data", () => {
  const word = createToken(/[a-z]+/);
  const parser = createParser(
    [word],
    {
      WORD(): Grammar<string> {
        return consume(
          word,
          (value) => value === "outer" ? parser("WORD", "inner") + "!" : value,
        );
      },
    },
    undefined,
    { compile: true },
  );
  assert.equal(parser("WORD", "outer"), "inner!");
  const data = createToken('"quoted"; `value` \\');
  const literal = createParser(
    [data],
    { VALUE: () => consume(data) },
    undefined,
    { compile: true },
  );
  assert.equal(
    literal("VALUE", '"quoted"; `value` \\'),
    '"quoted"; `value` \\',
  );
});
