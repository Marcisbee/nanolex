// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { expect } from "jsr:@std/expect";
import commonmark from "npm:commonmark-spec@0.31.2";

import { parseMarkdown, renderMarkdown } from "./markdown.ts";

Deno.test("passes all 652 CommonMark 0.31.2 examples", () => {
	for (
		const example of commonmark.tests as Array<{
			markdown: string;
			html: string;
			number: number;
		}>
	) {
		const markdown = example.markdown.replaceAll("→", "\t");
		const html = example.html.replaceAll("→", "\t");
		expect(
			renderMarkdown(parseMarkdown(markdown, { gfm: false })),
			`CommonMark example ${example.number}`,
		).toBe(html);
	}
});

const gfmExamples = [
	{
		name: "table alignment and uneven rows",
		markdown:
			"| abc | def |\n| :-: | --: |\n| bar |\n| bar | baz | ignored |\n",
		html:
			'<table>\n<thead>\n<tr>\n<th align="center">abc</th>\n<th align="right">def</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td align="center">bar</td>\n<td align="right"></td>\n</tr>\n<tr>\n<td align="center">bar</td>\n<td align="right">baz</td>\n</tr>\n</tbody>\n</table>\n',
	},
	{
		name: "strikethrough",
		markdown: "foo ~~bar~~ baz\n",
		html: "<p>foo <del>bar</del> baz</p>\n",
	},
	{
		name: "URL, www, and email autolinks",
		markdown:
			"Visit www.commonmark.org/a.b.\n\nhttps://example.com?q=(value)\n\nfoo.bar+baz@example.com\n",
		html:
			'<p>Visit <a href="http://www.commonmark.org/a.b">www.commonmark.org/a.b</a>.</p>\n<p><a href="https://example.com?q=(value)">https://example.com?q=(value)</a></p>\n<p><a href="mailto:foo.bar+baz@example.com">foo.bar+baz@example.com</a></p>\n',
	},
	{
		name: "task list items",
		markdown: "- [ ] todo\n- [x] done\n",
		html:
			'<ul>\n<li><input type="checkbox" disabled="" /> todo</li>\n<li><input type="checkbox" checked="" disabled="" /> done</li>\n</ul>\n',
	},
	{
		name: "disallowed raw HTML filtering",
		markdown: "<strong> <title> <style> <em>\n",
		html: "<p><strong> &lt;title> &lt;style> <em></p>\n",
	},
] as const;

for (const example of gfmExamples) {
	Deno.test(`passes GFM 0.29 ${example.name}`, () => {
		expect(
			renderMarkdown(parseMarkdown(example.markdown, { gfm: true }), {
				gfm: true,
			}),
		).toBe(example.html);
	});
}
