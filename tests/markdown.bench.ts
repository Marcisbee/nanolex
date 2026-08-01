import { parser } from "./markdown.ts";

const document = `---
title: Nanolex benchmark
---

# Markdown parser

Nanolex parses **strong text**, *emphasis*, \`code\`, [links](https://example.com),
escaped \\*punctuation*, entities such as &amp;, and autolinks like <bench@example.com>.

> A blockquote can contain:
> - nested lists
> - **formatted** content

| Feature | Supported |
| :--- | ---: |
| Tables | yes |
| Task lists | yes |

- [x] Parse blocks
- [x] Parse inline content
- [ ] Render the AST

\`\`\`ts
const ast = parser(markdown);
console.log(ast);
\`\`\`
`;

const largeDocument = Array.from(
	{ length: 100 },
	(_, index) => `## Section ${index}\n\n${document}`,
).join("\n");

Deno.bench("markdown: representative document", { group: "markdown" }, () => {
	parser(document);
});

Deno.bench(
	"markdown: 100-section document",
	{ group: "markdown-large" },
	() => {
		parser(largeDocument);
	},
);

const unmatchedBrackets = "[".repeat(100_000);
const delimiterRuns = `${"*".repeat(10_000)}text${"*".repeat(10_000)}`;

Deno.bench(
	"markdown: 100k unmatched brackets",
	{ group: "markdown-adversarial" },
	() => {
		parser(unmatchedBrackets);
	},
);

Deno.bench(
	"markdown: 20k delimiter run",
	{ group: "markdown-adversarial" },
	() => {
		parser(delimiterRuns);
	},
);
