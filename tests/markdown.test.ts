import { expect } from "jsr:@std/expect";

import { parser } from "./markdown.ts";

Deno.test(`parses "Hello world!"`, () => {
  expect(parser("Hello world!")).toEqual([
    {
      type: "p",
      content: [
        "Hello",
        " ",
        "world!",
      ],
    },
  ]);
});

Deno.test(`parses "## Hello **\`world\`**!"`, () => {
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

Deno.test(`parses "Hello **\`world\`**!\n===\nHey"`, () => {
  expect(parser("Hello **\`world\`**!\n===\nHey")).toEqual([
    {
      type: "h",
      size: 1,
      content: [
        "Hello",
        " ",
        { type: "b", content: [{ type: "c", content: ["world"] }] },
        "!",
      ],
    },
    "\n",
    {
      type: "p",
      content: ["Hey"],
    },
  ]);
});

Deno.test(`parses "foo\nbar\n\nbaz"`, () => {
  expect(parser("foo\nbar\n\nbaz")).toEqual([
    {
      type: "p",
      content: ["foo", "\n", "bar"],
    },
    "\n",
    "\n",
    {
      type: "p",
      content: ["baz"],
    },
  ]);
});
