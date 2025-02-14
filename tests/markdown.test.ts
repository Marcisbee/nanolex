import { expect } from "jsr:@std/expect";

import { parser } from "./markdown.ts";

Deno.test(`parses "1+1"`, () => {
  expect(parser("## Hello **`world`**!")).toEqual([
    {
      type: "h",
      size: 2,
      content: [
        "Hello",
        " ",
        { type: "b", content: [{ type: "c", content: ["world"] }] },
        "!",
      ],
    },
  ]);
});
