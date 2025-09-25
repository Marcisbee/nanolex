// deno-lint-ignore-file no-import-prefix no-unversioned-import
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

Deno.test(`parses "this_not_italic"`, () => {
  expect(parser("this_not_italic")).toEqual([
    {
      type: "p",
      content: ["this","_","not","_","italic"],
    },
  ]);
});

Deno.test(`parses "this_not_italic_"`, () => {
  expect(parser("this_not_italic_")).toEqual([
    {
      type: "p",
      content: ["this","_","not","_","italic","_"],
    },
  ]);
});

Deno.test(`parses "_this_not_italic_"`, () => {
  expect(parser("_this_not_italic_")).toEqual([
    {
      type: "p",
      content: ["_","this","_","not","_","italic","_"],
    },
  ]);
});

Deno.test(`parses "this _is_ italic"`, () => {
  expect(parser("this _is_ italic")).toEqual([
    {
      type: "p",
      content: ["this"," ",{ type: "i", content: ["is"] }," ","italic"],
    },
  ]);
});

Deno.test(`parses "this __is__ bold"`, () => {
  expect(parser("this __is__ bold")).toEqual([
    {
      type: "p",
      content: ["this"," ",{ type: "b", content: ["is"] }," ","bold"],
    },
  ]);
});

// Deno.test(`parses "foo\n> bar\n> baz\noof"`, () => {
//   expect(parser("foo\n> bar\n> baz\noof")).toEqual([
//     {
//       type: "p",
//       content: ["foo"],
//     },
//     {
//       type: "q",
//       content: ["bar", "\n", "baz"],
//     },
//     {
//       type: "p",
//       content: ["oof"],
//     },
//   ]);
// });
