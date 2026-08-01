// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "https://deno.land/std@0.215.0/assert/mod.ts";

import {
  and,
  consume,
  consumeAny,
  createParser,
  createToken,
  type Grammar,
  not,
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
