// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "https://deno.land/std@0.215.0/assert/mod.ts";

import {
  and,
  consume,
  consumeAny,
  type Context,
  createParser,
  createToken,
  type Grammar,
  not,
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
