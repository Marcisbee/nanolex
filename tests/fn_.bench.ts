import { assertEquals } from "https://deno.land/std@0.215.0/assert/mod.ts";

import { parser as fn1 } from "./fn.ts";

const input =
  `add(1,multiply(2,3),subtract(4,divide(5,6)),nested(7,8,deeply(9,10)),single(555),empty())`;
const output = fn1(input);

Deno.bench("fn1", { group: "parse" }, () => {
  assertEquals(fn1(input), output);
});
