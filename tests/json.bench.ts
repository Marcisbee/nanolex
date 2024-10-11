import { assertEquals } from "https://deno.land/std@0.215.0/assert/mod.ts";

import { parser } from "./json.ts";

const inputRaw = {
  a: [1, 2, "3", null, {}, []],
  b: {},
  c: {
    d: {
      e: "asd",
      f: 0,
    },
  },
};

const input = JSON.stringify(inputRaw);

Deno.bench("nanolex", { group: "json" }, () => {
  assertEquals(parser(input), inputRaw);
});

Deno.bench("JSON.parse", { group: "json" }, () => {
  assertEquals(JSON.parse(input), inputRaw);
});
