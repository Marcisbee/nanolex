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
			content: ["this", "_", "not", "_", "italic"],
		},
	]);
});

Deno.test(`parses "this_not_italic_"`, () => {
	expect(parser("this_not_italic_")).toEqual([
		{
			type: "p",
			content: ["this", "_", "not", "_", "italic", "_"],
		},
	]);
});

Deno.test(`parses "_this_not_italic_"`, () => {
	expect(parser("_this_not_italic_")).toEqual([
		{
			type: "p",
			content: ["_", "this", "_", "not", "_", "italic", "_"],
		},
	]);
});

Deno.test(`parses "this _is_ italic"`, () => {
	expect(parser("this _is_ italic")).toEqual([
		{
			type: "p",
			content: ["this", " ", { type: "i", content: ["is"] }, " ", "italic"],
		},
	]);
});

Deno.test(`parses "this __is__ bold"`, () => {
	expect(parser("this __is__ bold")).toEqual([
		{
			type: "p",
			content: ["this", " ", { type: "b", content: ["is"] }, " ", "bold"],
		},
	]);
});

Deno.test("parses empty input", () => {
	expect(parser("")).toEqual([]);
});

Deno.test("parses fenced code and a thematic break", () => {
	expect(parser("```ts strict\nconst value = 1;\n```\n---")).toEqual([
		{
			type: "code-block",
			language: "ts",
			meta: "strict",
			content: "const value = 1;\n",
		},
		"\n",
		{ type: "hr" },
	]);
});

Deno.test("parses nested blockquotes and lists", () => {
	expect(parser("> Intro\n> - one\n> - **two**")).toEqual([
		{
			type: "q",
			content: [
				{
					type: "p",
					content: ["Intro"],
				},
				"\n",
				{
					type: "ul",
					start: undefined,
					items: [
						{
							type: "li",
							checked: undefined,
							content: [{ type: "p", content: ["one"] }],
						},
						{
							type: "li",
							checked: undefined,
							content: [{
								type: "p",
								content: [{ type: "b", content: ["two"] }],
							}],
						},
					],
				},
			],
		},
	]);
});

Deno.test("parses ordered and task lists", () => {
	expect(parser("- [x] shipped\n- [ ] pending\n\n3. three\n4. four")).toEqual([
		{
			type: "ul",
			start: undefined,
			items: [
				{
					type: "li",
					checked: true,
					content: [{ type: "p", content: ["shipped"] }],
				},
				{
					type: "li",
					checked: false,
					content: [{ type: "p", content: ["pending"] }],
				},
			],
		},
		"\n",
		"\n",
		{
			type: "ol",
			start: 3,
			items: [
				{
					type: "li",
					checked: undefined,
					content: [{ type: "p", content: ["three"] }],
				},
				{
					type: "li",
					checked: undefined,
					content: [{ type: "p", content: ["four"] }],
				},
			],
		},
	]);
});

Deno.test("parses links, images, autolinks, entities, and escapes", () => {
	expect(
		parser(
			`[site](https://example.com "Example") ![logo](logo.png) <dev@example.com> &amp; \\*literal*`,
		),
	).toEqual([
		{
			type: "p",
			content: [
				{
					type: "a",
					href: "https://example.com",
					title: "Example",
					content: ["site"],
				},
				" ",
				{
					type: "img",
					src: "logo.png",
					title: undefined,
					alt: "logo",
				},
				" ",
				{
					type: "a",
					href: "mailto:dev@example.com",
					content: ["dev@example.com"],
				},
				" ",
				"&",
				" ",
				"*",
				"literal",
				"*",
			],
		},
	]);
});

Deno.test("resolves forward reference links", () => {
	expect(
		parser("[Nanolex][docs]\n\n[docs]: <https://example.com/docs> 'Docs'"),
	).toEqual([
		{
			type: "p",
			content: [{
				type: "a",
				href: "https://example.com/docs",
				title: "Docs",
				content: ["Nanolex"],
			}],
		},
		"\n",
		"\n",
	]);
});

Deno.test("parses GFM tables with alignment and inline content", () => {
	expect(parser("| Name | Score |\n| :--- | ---: |\n| **A** | 10 |")).toEqual([
		{
			type: "table",
			align: ["left", "right"],
			header: [["Name"], ["Score"]],
			rows: [
				[
					[{ type: "b", content: ["A"] }],
					["10"],
				],
			],
		},
	]);
});

Deno.test("parses frontmatter and normalizes CRLF", () => {
	expect(parser("---\r\ntitle: Demo\r\n---\r\n# Heading")).toEqual([
		{ type: "frontmatter", content: "title: Demo" },
		"\n",
		{ type: "h", size: 1, content: ["Heading"] },
	]);
});

Deno.test("leaves unmatched delimiters as text", () => {
	expect(parser("before **unfinished `code")).toEqual([
		{
			type: "p",
			content: ["before", " ", "*", "*", "unfinished", " ", "`", "code"],
		},
	]);
});
