// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.215.0/assert/mod.ts";

import {
  and,
  consume,
  consumeAny,
  type Context,
  createParser,
  createToken,
  type Grammar,
  not,
  oneOrMany,
  or,
  zeroOrOne,
} from "../src/nanolex.ts";

const A = createToken("a");
const B = createToken("b");
const Space = createToken(" ");

Deno.test("consumeAny preserves raw trivia", () => {
  const parser = createParser([Space, A], {
    RAW() {
      return and([consumeAny(), consume(A)]);
    },
  });

  assertEquals(parser("RAW", " a"), [" ", "a"]);
});

Deno.test("negative lookahead always restores the cursor", () => {
  const movingFailure: Grammar<never> = (ctx) => {
    ctx.pos += 1;
    return [ctx.pos, B];
  };
  const parser = createParser([Space, A, B], {
    LOOKAHEAD() {
      return and([not(movingFailure), consumeAny(), consume(A)]);
    },
  });

  assertEquals(parser("LOOKAHEAD", " a"), [null, " ", "a"]);
});

Deno.test("token caches do not collide with object prototype names", () => {
  const Identifier = createToken(/[a-z_]+/, "Identifier");
  const parser = createParser([Identifier], {
    IDENTIFIER() {
      return consume(Identifier);
    },
  });

  assertEquals(parser("IDENTIFIER", "constructor"), "constructor");
  assertEquals(parser("IDENTIFIER", "__proto__"), "__proto__");
});

Deno.test("sequences preserve values and roll back failures before transforms", () => {
  const context = (): Context => ({
    input: "ab",
    tokens: ["a", "b"],
    pos: 0,
    skipRule: null,
  });
  assertEquals(and([])(context()), [[], null]);
  assertEquals(and([], (values) => values.length)(context()), [0, null]);
  assertEquals(and([consume(A)])(context()), [["a"], null]);
  assertEquals(
    and([consume(A), consume(B)], (values) => values.join(""))(context()),
    ["ab", null],
  );

  for (const prefix of [[], [consume(A)]]) {
    const ctx = context();
    let transformed = false;
    const failure: Grammar<never> = (ctx) => [++ctx.pos, B];
    const result = and([...prefix, failure], () => {
      transformed = true;
    })(ctx);
    assertEquals(result, [prefix.length + 1, B]);
    assertEquals(transformed, false);
    assertEquals(ctx.pos, 0);
    assertEquals(consume(A)(ctx), ["a", null]);
  }
});

Deno.test("alternatives and optional rules retain values and backtracking", () => {
  const C = createToken("c");
  const parser = createParser([A, B, C], {
    VALUE() {
      return and([
        zeroOrOne(and([consume(A), consume(C)])),
        or([and([consume(A), consume(C)]), and([consume(A), consume(B)])]),
        zeroOrOne(consume(C), (value) => value?.toUpperCase()),
      ]);
    },
    TRANSFORMED() {
      return or([consume(A), consume(B)], (value) => value?.toUpperCase());
    },
  });
  assertEquals(parser("VALUE", "abc"), [undefined, ["a", "b"], "C"]);
  assertEquals(parser("VALUE", "ab"), [undefined, ["a", "b"], undefined]);
  assertEquals(parser("TRANSFORMED", "b"), "B");
});

Deno.test("regex token flags are isolated and matching is reusable", () => {
  const insensitive = createToken(/select/igy);
  const sensitive = createToken(/END/);
  const parser = createParser([insensitive, sensitive], {
    S: () => and([consume(insensitive), consume(sensitive)]),
  });
  insensitive.pattern instanceof RegExp && (insensitive.pattern.lastIndex = 4);
  for (let i = 0; i < 2; i++) {
    assertEquals(parser("S", "SELECTEND"), ["SELECT", "END"]);
    assertEquals(sensitive.test("end"), false);
    assertThrows(() => parser("S", "SELECTend"), Error, "expected END");
  }
  for (
    const [pattern, input] of [[/a.b/s, "a\nb"], [
      /\u{1F600}+/u,
      "😀😀",
    ]] as const
  ) {
    const token = createToken(pattern);
    const tail = createToken("!");
    const parse = createParser([token, tail], {
      S: () => and([consume(token), consume(tail)]),
    });
    assertEquals(parse("S", input + "!"), [input, "!"]);
  }
});

Deno.test("regex alternatives classify only complete tokens", () => {
  const identifier = createToken(/[a-z]+/);
  const keyword = createToken(/if|else/m);
  const parser = createParser([identifier, keyword], {
    S: () =>
      or([
        consume(keyword, (v) => `KW:${v}`),
        consume(identifier, (v) => `ID:${v}`),
      ]),
  });
  for (const word of ["iffy", "bigelse", "if", "else"]) {
    assertEquals(
      parser("S", word),
      `${["if", "else"].includes(word) ? "KW" : "ID"}:${word}`,
    );
  }
  for (const value of ["if\n", "x\nelse", "if\nx"]) {
    assertEquals(keyword.test(value), false);
  }
  assertEquals(createToken(/a|ab/).test("ab"), true);
});

Deno.test("token captures and backreferences do not introduce chunks", () => {
  const string = createToken(/'([^']*)'/);
  const separator = createToken(",");
  const parse = createParser([string, separator], {
    S: () => and([consume(string), consume(separator), consume(string)]),
  });
  assertEquals(parse("S", "'a','b'"), ["'a'", ",", "'b'"]);

  const first = createToken(/(x)\1/);
  const quoted = createToken(/(['"])(?<body>.*?)\1/);
  const comma = createToken(",");
  const parser = createParser([first, quoted, comma], {
    S: () =>
      and([
        consume(first),
        consume(comma),
        consume(quoted),
        consume(comma),
        consume(quoted),
      ]),
  });
  assertEquals(parser("S", "xx,'a',\"b\""), ["xx", ",", "'a'", ",", '"b"']);
});

Deno.test("tokenization preserves priority, unmatched text and zero-width boundaries", () => {
  for (const [patterns, input, expected] of [
    [[/a/, /ab/], "xab?", ["x", "a", "b?"]],
    [[/ab/, /a/], "xab?", ["x", "ab", "?"]],
    [[/(?=b)/], "abc", ["a", "bc"]],
    [[/x*/], "abc", ["a", "b", "c"]],
    [[/z/u], "😀z", ["😀", "z"]],
  ] as const) {
    const parser = createParser(patterns.map((pattern) => createToken(pattern)), {
      S: () => oneOrMany(consumeAny()),
    });
    assertEquals(parser("S", input), [...expected]);
  }
});
