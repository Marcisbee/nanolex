// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "https://deno.land/std@0.215.0/assert/mod.ts";

import { parser } from "./json.ts";

Deno.test("parses {}", () => {
  assertEquals(parser("{}"), {});
});

Deno.test("parses complex object", () => {
  const input = {
    a: [1, 2, "3", null, {}, []],
    b: {},
    c: {
      d: {
        e: "asd",
        f: 0,
      },
    },
  };
  assertEquals(parser(JSON.stringify(input)), input);
});
