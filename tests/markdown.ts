import {
	consume,
	createParser,
	createToken,
	zeroOrMany,
} from "../src/nanolex.ts";

export type InlineNode =
	| string
	| { type: "b" | "i" | "s"; content: InlineNode[] }
	| { type: "c"; content: string[] }
	| { type: "a"; href: string; title?: string; content: InlineNode[] }
	| { type: "img"; src: string; title?: string; alt: string }
	| { type: "br" }
	| { type: "html"; content: string };

export type BlockNode =
	| string
	| { type: "p"; content: InlineNode[] }
	| { type: "h"; size: number; content: InlineNode[] }
	| { type: "q"; content: InlineNode[] | BlockNode[] }
	| {
		type: "ul" | "ol";
		start?: number;
		items: Array<{
			type: "li";
			checked?: boolean;
			content: BlockNode[];
		}>;
	}
	| { type: "code-block"; language?: string; meta?: string; content: string }
	| { type: "hr" }
	| {
		type: "table";
		align: Array<"left" | "center" | "right" | null>;
		header: InlineNode[][];
		rows: InlineNode[][][];
	}
	| { type: "html"; content: string }
	| { type: "frontmatter"; content: string };

type Reference = { href: string; title?: string };
type References = Map<string, Reference>;

const MarkdownLine = createToken(
	/(?:[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+)/,
	"MarkdownLine",
);

const namedEntities: Record<string, string> = {
	amp: "&",
	apos: "'",
	copy: "©",
	gt: ">",
	hellip: "…",
	lt: "<",
	mdash: "—",
	ndash: "–",
	nbsp: "\u00a0",
	quot: '"',
	reg: "®",
	trade: "™",
};

function normalizeReference(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function decodeEntity(value: string): string | null {
	const body = value.slice(1, -1);
	if (body[0] !== "#") return namedEntities[body] ?? null;

	const hex = body[1]?.toLowerCase() === "x";
	const source = body.slice(hex ? 2 : 1);
	if (!source || !/^[\da-f]+$/i.test(source)) return null;
	const point = Number.parseInt(source, hex ? 16 : 10);
	if (
		!Number.isFinite(point) || point === 0 || point > 0x10ffff ||
		(point >= 0xd800 && point <= 0xdfff)
	) return "\ufffd";
	return String.fromCodePoint(point);
}

function bracketPairs(source: string): Map<number, number> {
	const pairs = new Map<number, number>();
	const open: number[] = [];
	for (let index = 0; index < source.length; index++) {
		if (source[index] === "\\") {
			index++;
		} else if (source[index] === "[") {
			open.push(index);
		} else if (source[index] === "]") {
			const start = open.pop();
			if (start !== undefined) pairs.set(start, index);
		}
	}
	return pairs;
}

function parseDestination(value: string): Reference | null {
	const trimmed = value.trim();
	const match = trimmed.match(
		/^(?:<([^<>\n]*)>|((?:\\.|[^\s()])+(?:\((?:\\.|[^()\s])*\)(?:\\.|[^\s()])*)?))(?:\s+(?:"([^"\n]*)"|'([^'\n]*)'|\(([^)\n]*)\)))?\s*$/,
	);
	if (!match) return null;
	return {
		href: (match[1] ?? match[2]).replace(
			/\\([\\!"#$%&'()*+,./:;<=>?@[\]^_`{|}~-])/g,
			"$1",
		),
		title: match[3] ?? match[4] ?? match[5] ?? undefined,
	};
}

function findClosingParen(source: string, start: number): number {
	let depth = 0;
	let angle = false;
	for (let i = start; i < source.length; i++) {
		const char = source[i];
		if (char === "\\") {
			i++;
			continue;
		}
		if (char === "<" && depth === 0) angle = true;
		if (char === ">" && angle) angle = false;
		if (angle) continue;
		if (char === "(") depth++;
		if (char === ")") {
			if (depth === 0) return i;
			depth--;
		}
	}
	return -1;
}

function isAlphaNumeric(value: string | undefined): boolean {
	return !!value && /[\p{L}\p{N}]/u.test(value);
}

function canOpen(
	source: string,
	index: number,
	size: number,
	underscore: boolean,
) {
	const before = source[index - 1];
	const after = source[index + size];
	return !!after && !/\s/.test(after) &&
		(!underscore || !isAlphaNumeric(before));
}

function canClose(
	source: string,
	index: number,
	size: number,
	underscore: boolean,
) {
	const before = source[index - 1];
	const after = source[index + size];
	return !!before && !/\s/.test(before) &&
		(!underscore || !isAlphaNumeric(after));
}

function findDelimiter(
	source: string,
	from: number,
	marker: string,
	underscore: boolean,
): number {
	let index = source.indexOf(marker, from);
	while (index !== -1) {
		if (
			source[index - 1] !== "\\" &&
			canClose(source, index, marker.length, underscore)
		) {
			return index;
		}
		index = source.indexOf(marker, index + marker.length);
	}
	return -1;
}

function pushText(output: InlineNode[], value: string) {
	if (value) output.push(value);
}

function parseInlines(
	source: string,
	references: References,
	depth = 0,
): InlineNode[] {
	if (depth > 32) return [source];

	const output: InlineNode[] = [];
	const brackets = bracketPairs(source);
	let index = 0;

	while (index < source.length) {
		const char = source[index];

		if (char === "\\") {
			if (source[index + 1] === "\n") {
				output.push({ type: "br" });
				index += 2;
			} else if (
				source[index + 1] &&
				/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[index + 1])
			) {
				pushText(output, source[index + 1]);
				index += 2;
			} else {
				pushText(output, "\\");
				index++;
			}
			continue;
		}

		if (char === "`") {
			let run = 1;
			while (source[index + run] === "`") run++;
			const marker = "`".repeat(run);
			const end = source.indexOf(marker, index + run);
			if (end !== -1) {
				let content = source.slice(index + run, end).replace(/\n/g, " ");
				if (
					content.length > 2 && content.startsWith(" ") &&
					content.endsWith(" ") && /[^ ]/.test(content)
				) content = content.slice(1, -1);
				output.push({ type: "c", content: content ? [content] : [] });
				index = end + run;
				continue;
			}
		}

		if (source.startsWith("![", index) || char === "[") {
			const image = char === "!";
			const labelStart = index + (image ? 2 : 1);
			const close = brackets.get(labelStart - 1);
			if (close !== undefined) {
				const label = source.slice(labelStart, close);
				let reference: Reference | undefined;
				let end = close + 1;

				if (source[end] === "(") {
					const closeParen = findClosingParen(source, end + 1);
					if (closeParen !== -1) {
						reference = parseDestination(source.slice(end + 1, closeParen)) ??
							undefined;
						end = closeParen + 1;
					}
				} else if (source[end] === "[") {
					const referenceEnd = brackets.get(end);
					if (referenceEnd !== undefined) {
						const id = source.slice(end + 1, referenceEnd) || label;
						reference = references.get(normalizeReference(id));
						end = referenceEnd + 1;
					}
				} else {
					reference = references.get(normalizeReference(label));
				}

				if (reference) {
					if (image) {
						output.push({
							type: "img",
							src: reference.href,
							title: reference.title,
							alt: label.replace(/[*_`~]/g, ""),
						});
					} else {
						output.push({
							type: "a",
							href: reference.href,
							title: reference.title,
							content: parseInlines(label, references, depth + 1),
						});
					}
					index = end;
					continue;
				}
			}
		}

		if (char === "<") {
			const rest = source.slice(index);
			const autoLink = rest.match(
				/^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^ <>\t\r\n]*)>/,
			);
			const email = rest.match(
				/^<([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+)>/i,
			);
			if (autoLink || email) {
				const label = (autoLink ?? email)![1];
				output.push({
					type: "a",
					href: autoLink
						? (label.toLowerCase().startsWith("mailto:") ? label : label)
						: `mailto:${label}`,
					content: [label.replace(/^mailto:/i, "")],
				});
				index += (autoLink ?? email)![0].length;
				continue;
			}

			const html = rest.match(
				/^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>\n]*?)?\s*\/?>|^<!--[\s\S]*?-->/,
			);
			if (html) {
				output.push({ type: "html", content: html[0] });
				index += html[0].length;
				continue;
			}
		}

		if (char === "&") {
			const entity = source.slice(index).match(
				/^&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/,
			);
			if (entity) {
				const decoded = decodeEntity(entity[0]);
				if (decoded !== null) {
					pushText(output, decoded);
					index += entity[0].length;
					continue;
				}
			}
		}

		const triple = source.slice(index, index + 3);
		if (
			(triple === "***" || triple === "___") &&
			canOpen(source, index, 3, triple[0] === "_")
		) {
			const end = findDelimiter(source, index + 3, triple, triple[0] === "_");
			if (end !== -1) {
				const content = parseInlines(
					source.slice(index + 3, end),
					references,
					depth + 1,
				);
				output.push({ type: "b", content: [{ type: "i", content }] });
				index = end + 3;
				continue;
			}
		}

		const pair = source.slice(index, index + 2);
		if (
			(pair === "**" || pair === "__" || pair === "~~") &&
			canOpen(source, index, 2, pair === "__")
		) {
			const end = findDelimiter(source, index + 2, pair, pair === "__");
			const inner = end === -1 ? "" : source.slice(index + 2, end);
			if (
				end !== -1 &&
				(pair !== "__" || !inner.includes("_"))
			) {
				output.push({
					type: pair === "~~" ? "s" : "b",
					content: parseInlines(inner, references, depth + 1),
				});
				index = end + 2;
				continue;
			}
			pushText(output, pair[0]);
			pushText(output, pair[1]);
			index += 2;
			continue;
		}

		if (
			(char === "*" || char === "_") &&
			canOpen(source, index, 1, char === "_")
		) {
			const end = findDelimiter(source, index + 1, char, char === "_");
			const inner = end === -1 ? "" : source.slice(index + 1, end);
			if (end !== -1 && (char !== "_" || !inner.includes("_"))) {
				output.push({
					type: "i",
					content: parseInlines(inner, references, depth + 1),
				});
				index = end + 1;
				continue;
			}
		}

		if (source.startsWith("  \n", index)) {
			output.push({ type: "br" });
			index += 3;
			continue;
		}

		if (/\s/.test(char)) {
			let end = index + 1;
			while (end < source.length && /[ \t]/.test(source[end])) end++;
			pushText(output, source.slice(index, end));
			index = end;
			continue;
		}

		if (
			"*_`[<~&\\".includes(char) || (char === "!" && source[index + 1] === "[")
		) {
			pushText(output, char);
			index++;
			continue;
		}

		let end = index + 1;
		while (end < source.length) {
			const next = source[end];
			if (
				/\s/.test(next) || "*_`[<~&\\".includes(next) ||
				(next === "!" && source[end + 1] === "[")
			) break;
			end++;
		}
		pushText(output, source.slice(index, end));
		index = end;
	}

	return output;
}

function splitTableRow(value: string): string[] {
	let source = value.trim();
	if (source.startsWith("|")) source = source.slice(1);
	if (source.endsWith("|") && source[source.length - 2] !== "\\") {
		source = source.slice(0, -1);
	}

	const cells: string[] = [];
	let cell = "";
	for (let index = 0; index < source.length; index++) {
		if (source[index] === "\\" && source[index + 1] === "|") {
			cell += "|";
			index++;
		} else if (source[index] === "|") {
			cells.push(cell.trim());
			cell = "";
		} else {
			cell += source[index];
		}
	}
	cells.push(cell.trim());
	return cells;
}

function tableAlignment(value: string): "left" | "center" | "right" | null {
	const trimmed = value.trim();
	if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
	if (trimmed.startsWith(":")) return "left";
	if (trimmed.endsWith(":")) return "right";
	return null;
}

function isTableDelimiter(value: string): boolean {
	const cells = splitTableRow(value);
	return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function listMatch(value: string) {
	return value.match(/^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/);
}

function isThematicBreak(value: string): boolean {
	return /^ {0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/.test(value);
}

function isFence(value: string): boolean {
	return /^ {0,3}(`{3,}|~{3,})/.test(value);
}

function isAtxHeading(value: string): boolean {
	return /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(value);
}

function isHtmlBlock(value: string): boolean {
	return /^ {0,3}(?:<!--|<\/?(?:address|article|aside|base|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|pre|script|search|section|style|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>))/i
		.test(value);
}

function isBlockStart(lines: string[], index: number): boolean {
	const value = lines[index] ?? "";
	return value.trim() === "" || isFence(value) || isAtxHeading(value) ||
		isThematicBreak(value) || /^ {0,3}>/.test(value) ||
		!!listMatch(value) || /^(?: {4}|\t)/.test(value) || isHtmlBlock(value) ||
		(index + 1 < lines.length &&
			/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[index + 1]));
}

function collectReferences(lines: string[]): References {
	const references: References = new Map();
	for (const line of lines) {
		const match = line.match(
			/^ {0,3}\[([^\]]+)\]:[ \t]*(?:<([^>]+)>|(\S+))(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/,
		);
		if (match) {
			references.set(normalizeReference(match[1]), {
				href: match[2] ?? match[3],
				title: match[4] ?? match[5] ?? match[6] ?? undefined,
			});
		}
	}
	return references;
}

function isReferenceDefinition(value: string): boolean {
	return /^ {0,3}\[[^\]]+\]:[ \t]*(?:<[^>]+>|\S+)/.test(value);
}

function parseBlocks(
	lines: string[],
	references: References,
	allowFrontmatter = true,
): BlockNode[] {
	const output: BlockNode[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index];

		if (line === "" && index === lines.length - 1) break;
		if (line.trim() === "") {
			if (index + 1 < lines.length) output.push("\n");
			index++;
			continue;
		}

		if (isReferenceDefinition(line)) {
			index++;
			continue;
		}

		if (
			allowFrontmatter && index === 0 && line === "---" &&
			lines.indexOf("---", 1) > 0
		) {
			const end = lines.indexOf("---", 1);
			output.push({
				type: "frontmatter",
				content: lines.slice(1, end).join("\n"),
			});
			index = end + 1;
			if (index < lines.length) output.push("\n");
			continue;
		}

		const fence = line.match(
			/^ {0,3}(`{3,}|~{3,})[ \t]*([^ \t`]*)?[ \t]*(.*)$/,
		);
		if (fence) {
			const marker = fence[1][0];
			const size = fence[1].length;
			const body: string[] = [];
			let cursor = index + 1;
			while (
				cursor < lines.length &&
				!new RegExp(`^ {0,3}${marker === "`" ? "`" : "~"}{${size},}[ \\t]*$`)
					.test(lines[cursor])
			) {
				body.push(lines[cursor]);
				cursor++;
			}
			output.push({
				type: "code-block",
				language: fence[2] || undefined,
				meta: fence[3] || undefined,
				content: body.join("\n") + (body.length ? "\n" : ""),
			});
			index = cursor < lines.length ? cursor + 1 : cursor;
			if (index < lines.length) output.push("\n");
			continue;
		}

		if (/^(?: {4}|\t)/.test(line)) {
			const body: string[] = [];
			let cursor = index;
			while (cursor < lines.length) {
				if (/^ {4}/.test(lines[cursor])) body.push(lines[cursor].slice(4));
				else if (/^\t/.test(lines[cursor])) body.push(lines[cursor].slice(1));
				else if (lines[cursor].trim() === "") body.push("");
				else break;
				cursor++;
			}
			while (body.at(-1) === "") body.pop();
			output.push({
				type: "code-block",
				content: body.join("\n") + (body.length ? "\n" : ""),
			});
			index = cursor;
			if (index < lines.length) output.push("\n");
			continue;
		}

		const heading = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/);
		if (heading) {
			const content = (heading[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "");
			output.push({
				type: "h",
				size: heading[1].length,
				content: parseInlines(content, references),
			});
			index++;
			if (index < lines.length) output.push("\n");
			continue;
		}

		if (
			index + 1 < lines.length &&
			/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[index + 1]) &&
			line.trim()
		) {
			output.push({
				type: "h",
				size: lines[index + 1].trimStart().startsWith("=") ? 1 : 2,
				content: parseInlines(line.trim(), references),
			});
			index += 2;
			if (index < lines.length) output.push("\n");
			continue;
		}

		if (isThematicBreak(line)) {
			output.push({ type: "hr" });
			index++;
			if (index < lines.length) output.push("\n");
			continue;
		}

		if (/^ {0,3}>/.test(line)) {
			const quoteLines: string[] = [];
			let cursor = index;
			while (cursor < lines.length) {
				const quote = lines[cursor].match(/^ {0,3}>[ \t]?(.*)$/);
				if (quote) quoteLines.push(quote[1]);
				else if (
					lines[cursor].trim() === "" &&
					cursor + 1 < lines.length &&
					/^ {0,3}>/.test(lines[cursor + 1])
				) quoteLines.push("");
				else break;
				cursor++;
			}
			const blocks = parseBlocks(quoteLines, references, false);
			const meaningful = blocks.filter((node) => node !== "\n");
			const only = meaningful[0];
			const content = meaningful.length === 1 && typeof only !== "string" &&
					only?.type === "p"
				? only.content
				: blocks;
			output.push({ type: "q", content });
			index = cursor;
			if (index < lines.length) output.push("\n");
			continue;
		}

		const list = listMatch(line);
		if (list) {
			const ordered = /^\d/.test(list[2]);
			const markerColumn = list[1].length;
			const items: Array<{
				type: "li";
				checked?: boolean;
				content: BlockNode[];
			}> = [];
			let cursor = index;

			while (cursor < lines.length) {
				const item = listMatch(lines[cursor]);
				if (
					!item || /^\d/.test(item[2]) !== ordered ||
					item[1].length !== markerColumn
				) break;

				const itemLines = [item[4]];
				const contentIndent = item[1].length + item[2].length + item[3].length;
				cursor++;
				while (cursor < lines.length) {
					const nextItem = listMatch(lines[cursor]);
					if (
						nextItem && /^\d/.test(nextItem[2]) === ordered &&
						nextItem[1].length === markerColumn
					) break;
					if (lines[cursor].trim() === "") {
						const afterBlank = lines[cursor + 1];
						const followingItem = afterBlank === undefined
							? null
							: listMatch(afterBlank);
						const followingIndent = afterBlank?.match(/^[ \t]*/)?.[0].length ??
							0;
						if (
							afterBlank !== undefined &&
							((followingItem &&
								/^\d/.test(followingItem[2]) === ordered &&
								followingItem[1].length === markerColumn) ||
								followingIndent > markerColumn)
						) {
							itemLines.push("");
							cursor++;
							continue;
						}
						break;
					}
					const indentation = lines[cursor].match(/^[ \t]*/)?.[0].length ?? 0;
					if (indentation <= markerColumn && isBlockStart(lines, cursor)) break;
					itemLines.push(
						lines[cursor].startsWith(" ".repeat(contentIndent))
							? lines[cursor].slice(contentIndent)
							: lines[cursor].trimStart(),
					);
					cursor++;
				}

				const task = itemLines[0].match(/^\[([ xX])\][ \t]+(.*)$/);
				if (task) itemLines[0] = task[2];
				items.push({
					type: "li",
					checked: task ? task[1].toLowerCase() === "x" : undefined,
					content: parseBlocks(itemLines, references, false),
				});
			}

			output.push({
				type: ordered ? "ol" : "ul",
				start: ordered ? Number.parseInt(list[2]) : undefined,
				items,
			});
			index = cursor;
			if (index < lines.length) output.push("\n");
			continue;
		}

		if (
			index + 1 < lines.length && line.includes("|") &&
			isTableDelimiter(lines[index + 1])
		) {
			const headers = splitTableRow(line);
			const delimiter = splitTableRow(lines[index + 1]);
			const rows: InlineNode[][][] = [];
			let cursor = index + 2;
			while (
				cursor < lines.length && lines[cursor].includes("|") &&
				lines[cursor].trim()
			) {
				const cells = splitTableRow(lines[cursor]);
				rows.push(
					headers.map((_, cell) => parseInlines(cells[cell] ?? "", references)),
				);
				cursor++;
			}
			output.push({
				type: "table",
				align: headers.map((_, cell) => tableAlignment(delimiter[cell] ?? "")),
				header: headers.map((cell) => parseInlines(cell, references)),
				rows,
			});
			index = cursor;
			if (index < lines.length) output.push("\n");
			continue;
		}

		if (isHtmlBlock(line)) {
			const body = [line];
			let cursor = index + 1;
			while (cursor < lines.length && lines[cursor].trim()) {
				body.push(lines[cursor]);
				cursor++;
			}
			output.push({ type: "html", content: body.join("\n") });
			index = cursor;
			if (index < lines.length) output.push("\n");
			continue;
		}

		const paragraph = [line];
		let cursor = index + 1;
		while (cursor < lines.length && !isBlockStart(lines, cursor)) {
			if (isReferenceDefinition(lines[cursor])) break;
			paragraph.push(lines[cursor]);
			cursor++;
		}
		output.push({
			type: "p",
			content: parseInlines(paragraph.join("\n"), references),
		});
		index = cursor;
		if (index < lines.length) output.push("\n");
	}

	return output;
}

function parseMarkdown(input: string): BlockNode[] {
	const normalized = input.replace(/\r\n?/g, "\n");
	const lines = normalized.split("\n");
	const references = collectReferences(lines);
	return parseBlocks(lines, references);
}

const markdownParser = createParser(
	[MarkdownLine],
	{
		DOCUMENT() {
			return zeroOrMany(
				consume(MarkdownLine),
				(lines) => parseMarkdown(lines.join("")),
			);
		},
	},
);

/**
 * Parse Markdown into a compact AST. Text remains as strings for compatibility
 * with the original Nanolex Markdown example.
 */
export function parser(input: string): BlockNode[] {
	return markdownParser("DOCUMENT", input);
}

if (import.meta.main) {
	const sample =
		`# Nanolex\n\n- Fast\n- **Typed** and [linked](https://example.com)\n\n\`\`\`ts\nconsole.log("Markdown");\n\`\`\``;
	console.log(JSON.stringify(parser(sample), null, 2));
}
