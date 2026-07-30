import { createSourceParser, type SourceContext } from "./nanolex.ts";
import { htmlEntities } from "./markdown_entities.ts";

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
		loose?: boolean;
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
	| { type: "html"; content: string; block: true }
	| { type: "frontmatter"; content: string };

type Reference = { href: string; title?: string };
type References = Map<string, Reference> & { gfm: boolean };

function normalizeReference(value: string): string {
	return value.replace(/\\([[\]\\])/g, "$1").trim().replace(/\s+/g, " ")
		.toLowerCase()
		.replaceAll("ß", "ss");
}

function decodeEntity(value: string): string | null {
	const body = value.slice(1, -1);
	if (body[0] !== "#") return htmlEntities[body] ?? null;

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

function decodeMarkdownString(source: string): string {
	return source.replace(
		/\\([\\!"#$%&'()*+,./:;<=>?@[\]^_`{|}~-])/g,
		"$1",
	).replace(
		/&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g,
		(entity) => decodeEntity(entity) ?? entity,
	);
}

function bracketPairs(source: string): Map<number, number> {
	const pairs = new Map<number, number>();
	const open: number[] = [];
	for (let index = 0; index < source.length; index++) {
		if (source[index] === "\\") {
			index++;
		} else if (source[index] === "`") {
			const size = delimiterRun(source, index);
			const end = findClosingRun(source, index + size, "`".repeat(size));
			if (end !== -1) index = end + size - 1;
		} else if (source[index] === "<") {
			const angle = source.slice(index).match(/^<[^>\n]*>/);
			if (angle) index += angle[0].length - 1;
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
	const trimmed = value.replace(/^[ \t\n]+|[ \t\n]+$/g, "");
	if (trimmed === "") return { href: "" };
	let href = "";
	let offset = 0;
	if (trimmed[0] === "<") {
		const end = trimmed.indexOf(">");
		if (end === -1 || /[<\n]/.test(trimmed.slice(1, end))) return null;
		href = trimmed.slice(1, end);
		offset = end + 1;
	} else {
		let depth = 0;
		for (; offset < trimmed.length; offset++) {
			const char = trimmed[offset];
			if (char === "\\") {
				offset++;
				continue;
			}
			if (/[ \t\n]/.test(char) && depth === 0) break;
			if (char === "(") {
				if (++depth > 32) return null;
			} else if (char === ")") {
				if (depth === 0) return null;
				depth--;
			}
		}
		if (depth !== 0) return null;
		href = trimmed.slice(0, offset);
	}
	const rest = trimmed.slice(offset).replace(/^[ \t\n]+|[ \t\n]+$/g, "");
	let title: string | undefined;
	if (rest) {
		if (!/[ \t\n]/.test(trimmed[offset] ?? "")) return null;
		const quote = rest[0];
		const close = quote === "(" ? ")" : quote;
		if (
			rest.length < 2 || !`"'(`.includes(quote) || rest.at(-1) !== close
		) return null;
		const inner = rest.slice(1, -1);
		if (
			inner.includes("\n\n") ||
			(quote === "(" && /(?<!\\)[()]/.test(inner)) ||
			(quote !== "(" && new RegExp(`(?<!\\\\)${quote}`).test(inner))
		) return null;
		title = decodeMarkdownString(inner);
	}
	return {
		href: decodeMarkdownString(href),
		title,
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

function findClosingRun(
	source: string,
	from: number,
	marker: string,
): number {
	let index = source.indexOf(marker[0], from);
	while (index !== -1) {
		const run = delimiterRun(source, index);
		if (run === marker.length) return index;
		index = source.indexOf(marker[0], index + run);
	}
	return -1;
}

function isWhitespace(value: string | undefined): boolean {
	return value === undefined || /\s/u.test(value);
}

function isPunctuation(value: string | undefined): boolean {
	return !!value && /[\p{P}\p{S}]/u.test(value);
}

function delimiterRun(source: string, index: number): number {
	const marker = source[index];
	let size = 1;
	while (source[index + size] === marker) size++;
	return size;
}

function delimiterFlanking(
	source: string,
	index: number,
	size: number,
	underscore: boolean,
): { canOpen: boolean; canClose: boolean } {
	const before = source[index - 1];
	const after = source[index + size];
	const left = !isWhitespace(after) &&
		(!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
	const right = !isWhitespace(before) &&
		(!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
	return {
		canOpen: left && (!underscore || !right || isPunctuation(before)),
		canClose: right && (!underscore || !left || isPunctuation(after)),
	};
}

function findDelimiter(
	source: string,
	from: number,
	marker: string,
	underscore: boolean,
	openerIndex: number,
	openerSize: number,
): number {
	const delimiter = marker[0];
	let index = source.indexOf(delimiter, from);
	while (index !== -1) {
		const run = delimiterRun(source, index);
		const closer = delimiterFlanking(source, index, run, underscore);
		const opener = delimiterFlanking(
			source,
			openerIndex,
			openerSize,
			underscore,
		);
		const oddMatch = (opener.canClose || closer.canOpen) &&
			(openerSize + run) % 3 === 0 &&
			(openerSize % 3 !== 0 || run % 3 !== 0);
		if (
			source[index - 1] !== "\\" &&
			run >= marker.length && closer.canClose && !oddMatch
		) {
			return index;
		}
		index = source.indexOf(delimiter, index + run);
	}
	return -1;
}

function pushText(output: InlineNode[], value: string) {
	if (value) output.push(value);
}

function containsLink(nodes: InlineNode[]): boolean {
	return nodes.some((node) =>
		typeof node !== "string" &&
		(node.type === "a" ||
			(("content" in node && Array.isArray(node.content)) &&
				containsLink(node.content as InlineNode[])))
	);
}

function inlineText(nodes: InlineNode[]): string {
	let output = "";
	for (const node of nodes) {
		if (typeof node === "string") output += node;
		else if (node.type === "img") output += node.alt;
		else if (node.type === "br") output += "\n";
		else if (node.type === "html") {
			// Raw HTML does not contribute to an image's plain-text alt value.
		} else if (node.type === "c") output += node.content.join("");
		else output += inlineText(node.content);
	}
	return output;
}

function gfmAutolinkAt(
	source: string,
	index: number,
): { href: string; label: string; length: number } | null {
	const rest = source.slice(index);
	const previous = source[index - 1];
	const boundary = previous === undefined || !/[A-Za-z0-9_]/.test(previous);
	if (boundary) {
		const url = rest.match(/^(?:(?:https?|ftp):\/\/|www\.)[^\s<>]+/i);
		if (url) {
			let label = url[0];
			const entity = label.match(/&[A-Za-z][A-Za-z0-9]+;$/);
			if (entity) label = label.slice(0, -entity[0].length);
			label = label.replace(/[.,:;!?]+$/, "");
			let opens = 0;
			let closes = 0;
			for (const char of label) {
				if (char === "(") opens++;
				else if (char === ")") closes++;
			}
			while (closes > opens && label.endsWith(")")) {
				label = label.slice(0, -1);
				closes--;
			}
			if (
				label && (!/^www\./i.test(label) ||
					/^www\.(?:[^.\s]+\.)+[^.\s]+/.test(label))
			) {
				return {
					href: /^www\./i.test(label) ? `http://${label}` : label,
					label,
					length: label.length,
				};
			}
		}
	}
	const email = rest.match(
		/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/i,
	);
	if (
		email && !/[-_]/.test(source[index + email[0].length] ?? "") &&
		(previous === undefined ||
			!/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]/.test(previous))
	) {
		return {
			href: `mailto:${email[0]}`,
			label: email[0],
			length: email[0].length,
		};
	}
	return null;
}

function gfmAutolinks(
	source: string,
): Map<number, { href: string; label: string; length: number }> {
	const links = new Map<
		number,
		{ href: string; label: string; length: number }
	>();
  const candidates =
    /(?:(?:https?|ftp):\/\/|www\.)|[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9]/gi;
  for (const candidate of source.matchAll(candidates)) {
    const index = candidate.index ?? 0;
		const link = gfmAutolinkAt(source, index);
		if (link) links.set(index, link);
	}
	return links;
}

type EmphasisPair = {
	openEnd: number;
	closeStart: number;
	closeEnd: number;
	type: "i" | "b";
};

function emphasisPairs(
	source: string,
	references: References,
	brackets: Map<number, number>,
): Map<number, EmphasisPair> {
	type Delimiter = {
		start: number;
		size: number;
		remaining: number;
		consumedLeft: number;
		marker: "*" | "_";
		canOpen: boolean;
		canClose: boolean;
	};
	const linkRanges = [...brackets].filter(([open, close]) => {
		const label = source.slice(open + 1, close);
		return source[close + 1] === "(" || source[close + 1] === "[" ||
			references.has(normalizeReference(label));
	});
	const linkContainer = (position: number): number => {
		for (let index = 0; index < linkRanges.length; index++) {
			const [open, close] = linkRanges[index];
			if (position > open && position < close) return index;
		}
		return -1;
	};
	const delimiters: Delimiter[] = [];
	for (let index = 0; index < source.length;) {
		if (source[index] === "\\") {
			index += 2;
			continue;
		}
		if (source[index] === "`") {
			const size = delimiterRun(source, index);
			const end = findClosingRun(source, index + size, "`".repeat(size));
			index = end === -1 ? index + size : end + size;
			continue;
		}
		if (source[index] === "<") {
			const angle = source.slice(index).match(
				/^<(?:[A-Za-z/!?][^>\n]*|[A-Za-z][A-Za-z0-9+.-]{1,31}:[^>\n]*)>/,
			);
			if (angle) {
				index += angle[0].length;
				continue;
			}
		}
		if (source[index] !== "*" && source[index] !== "_") {
			index++;
			continue;
		}
		const size = delimiterRun(source, index);
		const flanking = delimiterFlanking(
			source,
			index,
			size,
			source[index] === "_",
		);
		delimiters.push({
			start: index,
			size,
			remaining: size,
			consumedLeft: 0,
			marker: source[index] as "*" | "_",
			...flanking,
		});
		index += size;
	}

	const pairs = new Map<number, EmphasisPair>();
	const stack: Delimiter[] = [];
	for (const closer of delimiters) {
		if (closer.canClose) {
			while (closer.remaining > 0) {
				let openerIndex = stack.length - 1;
				for (; openerIndex >= 0; openerIndex--) {
					const candidate = stack[openerIndex];
					if (
						candidate.marker !== closer.marker || !candidate.canOpen ||
						candidate.remaining === 0
					) continue;
					if (
						linkContainer(candidate.start) !== linkContainer(closer.start)
					) continue;
					const oddMatch = (candidate.canClose || closer.canOpen) &&
						(candidate.remaining + closer.remaining) % 3 === 0 &&
						(candidate.remaining % 3 !== 0 ||
							closer.remaining % 3 !== 0);
					if (!oddMatch) break;
				}
				if (openerIndex < 0) break;
				const opener = stack[openerIndex];
				const use = opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 1;
				const openStart = opener.start + opener.remaining - use;
				const closeStart = closer.start + closer.consumedLeft;
				pairs.set(openStart, {
					openEnd: openStart + use,
					closeStart,
					closeEnd: closeStart + use,
					type: use === 2 ? "b" : "i",
				});
				opener.remaining -= use;
				closer.remaining -= use;
				closer.consumedLeft += use;
				stack.length = openerIndex + 1;
				if (opener.remaining === 0) stack.pop();
			}
		}
		if (closer.canOpen && closer.remaining > 0) stack.push(closer);
	}
	return pairs;
}

function parseInlines(
	source: string,
	references: References,
	depth = 0,
): InlineNode[] {
	if (depth > 32) return [source];

	const output: InlineNode[] = [];
	const brackets = source.includes("[") ? bracketPairs(source) : new Map();
	const emphasis = source.includes("*") || source.includes("_")
		? emphasisPairs(source, references, brackets)
		: new Map<number, EmphasisPair>();
	const autolinks = references.gfm
		? gfmAutolinks(source)
		: new Map<number, { href: string; label: string; length: number }>();
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
			const end = findClosingRun(source, index + run, marker);
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
			for (let count = 0; count < run; count++) pushText(output, "`");
			index += run;
			continue;
		}

		const gfmAutolink = autolinks.get(index);
		if (gfmAutolink) {
			output.push({
				type: "a",
				href: gfmAutolink.href,
				content: [gfmAutolink.label],
			});
			index += gfmAutolink.length;
			continue;
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
						const inline = parseDestination(
							source.slice(end + 1, closeParen),
						);
						if (inline) {
							reference = inline;
							end = closeParen + 1;
						} else {
							reference = references.get(normalizeReference(label));
						}
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
					const content = parseInlines(label, references, depth + 1);
					if (!image && containsLink(content)) {
						pushText(output, "[");
						index = labelStart;
						continue;
					}
					if (image) {
						output.push({
							type: "img",
							src: reference.href,
							title: reference.title,
							alt: inlineText(content),
						});
					} else {
						output.push({
							type: "a",
							href: reference.href,
							title: reference.title,
							content,
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
					content: [label.startsWith("mailto:") ? label.slice(7) : label],
				});
				index += (autoLink ?? email)![0].length;
				continue;
			}

			const html = rest.match(
				/^(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>|<!--(?:>|->|[\s\S]*?-->)|<\?[\s\S]*?\?>|<![A-Z]+(?:\s+[^>]*)?>|<!\[CDATA\[[\s\S]*?\]\]>)/,
			);
			if (html) {
				if (
					references.gfm &&
					/^<\/?(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?:\s|>|\/)/i
						.test(html[0])
				) {
					output.push({
						type: "html",
						content: `&lt;${html[0].slice(1)}`,
					});
					index += html[0].length;
					continue;
				}
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

		if (char === "*" || char === "_") {
			const pair = emphasis.get(index);
			if (pair) {
				output.push({
					type: pair.type,
					content: parseInlines(
						source.slice(pair.openEnd, pair.closeStart),
						references,
						depth + 1,
					),
				});
				index = pair.closeEnd;
				continue;
			}
			const run = delimiterRun(source, index);
			let nestedPair = -1;
			for (let offset = 1; offset < run; offset++) {
				if (emphasis.has(index + offset)) {
					nestedPair = index + offset;
					break;
				}
			}
			if (nestedPair !== -1) {
				for (let cursor = index; cursor < nestedPair; cursor++) {
					pushText(output, char);
				}
				index = nestedPair;
				continue;
			}
			for (let count = 0; count < run; count++) pushText(output, char);
			index += run;
			continue;
		}

		if (char === "~") {
			const run = delimiterRun(source, index);
			const strike = char === "~";
			const flanking = delimiterFlanking(
				source,
				index,
				run,
				false,
			);
			if (flanking.canOpen && (!strike || run >= 2)) {
				const size = 2;
				const marker = char.repeat(size);
				const end = findDelimiter(
					source,
					index + size,
					marker,
					false,
					index,
					run,
				);
				if (end !== -1) {
					output.push({
						type: "s",
						content: parseInlines(
							source.slice(index + size, end),
							references,
							depth + 1,
						),
					});
					index = end + size;
					continue;
				}
			}
			for (let count = 0; count < run; count++) pushText(output, char);
			index += run;
			continue;
		}

		if (source.startsWith("  \n", index)) {
			output.push({ type: "br" });
			index += 3;
			continue;
		}

		if (/\s/.test(char)) {
			let end = index + 1;
			while (end < source.length && /[ \t]/.test(source[end])) end++;
			if (
				source[end] === "\n" &&
				source.slice(index, end).replaceAll("\t", "").length >= 2
			) {
				output.push({ type: "br" });
				index = end + 1;
				continue;
			}
			if (end === source.length) {
				index = end;
				continue;
			}
			if (source[end] === "\n") {
				pushText(output, "\n");
				index = end + 1;
				continue;
			}
			pushText(output, source.slice(index, end));
			index = end;
			continue;
		}

		if (
			"*_`[<~&\\:".includes(char) ||
			(char === "!" && source[index + 1] === "[")
		) {
			pushText(output, char);
			index++;
			continue;
		}

		let end = index + 1;
		while (end < source.length) {
			const next = source[end];
			if (
				/\s/.test(next) || "*_`[<~&\\:".includes(next) ||
				(next === "!" && source[end + 1] === "[") ||
				autolinks.has(end)
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
	return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function listMatch(value: string) {
	const marker = value.match(/^( {0,3})([-+*]|\d{1,9}[.)])(.*)$/);
	if (!marker) return null;
	const rest = marker[3];
	if (rest !== "" && !/^[ \t]/.test(rest)) return null;
	if (rest.trim() === "") {
		return [value, marker[1], marker[2], " ", ""] as const;
	}
	const whitespace = rest.match(/^[ \t]+/)?.[0] ?? "";
	const width = whitespace.replaceAll("\t", "    ").length;
	const used = width <= 4 ? whitespace : whitespace[0];
	return [
		value,
		marker[1],
		marker[2],
		used,
		rest.slice(used.length),
	] as const;
}

function containerLeafIsParagraph(value: string): boolean {
	let source = value;
	for (let depth = 0; depth < 32; depth++) {
		const list = listMatch(source);
		if (list) {
			source = list[4] ?? "";
			continue;
		}
		const quote = source.match(/^ {0,3}>[ \t]?(.*)$/);
		if (quote) {
			source = quote[1];
			continue;
		}
		break;
	}
	return source.trim() !== "" && !isFence(source) && !isAtxHeading(source) &&
		!isThematicBreak(source) && !/^(?: {4}|\t)/.test(source) &&
		!isHtmlBlock(source, false);
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

function htmlBlockKind(value: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 | null {
	const source = value.replace(/^ {0,3}/, "");
	if (/^<(?:script|pre|style|textarea)(?:\s|>|$)/i.test(source)) return 1;
	if (source.startsWith("<!--")) return 2;
	if (source.startsWith("<?")) return 3;
	if (/^<![A-Z]/.test(source)) return 4;
	if (source.startsWith("<![CDATA[")) return 5;
	if (
		/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i
			.test(source)
	) return 6;
	if (
		/^(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)[ \t]*$/
			.test(source)
	) return 7;
	return null;
}

function isHtmlBlock(value: string, interruptParagraph = true): boolean {
	const kind = htmlBlockKind(value);
	return kind !== null && (!interruptParagraph || kind !== 7);
}

function isBlockStart(lines: string[], index: number): boolean {
	const value = lines[index] ?? "";
	const list = listMatch(value);
	const listCanInterrupt = !!list && (list[4]?.trim() ?? "") !== "" &&
		(!/^\d/.test(list[2]) || Number.parseInt(list[2]) === 1);
	return value.trim() === "" || isFence(value) || isAtxHeading(value) ||
		isThematicBreak(value) || /^ {0,3}>/.test(value) ||
		listCanInterrupt || /^(?: {4}|\t)/.test(value) || isHtmlBlock(value) ||
		(index + 1 < lines.length &&
			/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[index + 1]));
}

type ParsedReferenceDefinition = {
	key: string;
	reference: Reference;
	end: number;
};

function parseReferenceDefinition(
	lines: string[],
	index: number,
): ParsedReferenceDefinition | null {
	const first = lines[index]?.replace(/^ {0,3}/, "") ?? "";
	if (!first.startsWith("[")) return null;
	let label = "";
	let lineIndex = index;
	let offset = 1;
	let rest: string | null = null;
	for (; lineIndex < lines.length && label.length <= 999; lineIndex++) {
		const line = lineIndex === index ? first : lines[lineIndex].trim();
		if (lineIndex !== index && line === "") return null;
		for (; offset < line.length; offset++) {
			const char = line[offset];
			if (char === "\\" && offset + 1 < line.length) {
				label += line.slice(offset, offset + 2);
				offset++;
				continue;
			}
			if (char === "[") return null;
			if (char === "]" && line[offset + 1] === ":") {
				rest = line.slice(offset + 2).replace(/^[ \t]+/, "");
				break;
			}
			label += char;
		}
		if (rest !== null) break;
		if (lineIndex === index) label += "\n";
		offset = 0;
	}
	if (rest === null || label.length === 0 || label.length > 999) return null;
	if (normalizeReference(label) === "") return null;

	let candidate = rest.replace(/[ \t]+$/, "");
	let end = lineIndex;
	if (!candidate) {
		if (end + 1 >= lines.length || lines[end + 1].trim() === "") return null;
		candidate = lines[++end].trim();
	}
	let reference = parseDestination(candidate);
	if (
		reference && reference.title === undefined && end + 1 < lines.length &&
		/^[ \t]*["'(]/.test(lines[end + 1])
	) {
		const withTitle = parseDestination(
			`${candidate}\n${lines[end + 1].trim()}`,
		);
		if (withTitle) {
			reference = withTitle;
			end++;
		}
	}
	while (
		!reference && end + 1 < lines.length && lines[end + 1].trim() !== "" &&
		end < lineIndex + 20
	) {
		candidate += `\n${lines[++end].trim()}`;
		reference = parseDestination(candidate);
	}
	if (!reference) return null;
	return {
		key: normalizeReference(label.replace(/\\([[\]\\])/g, "$1")),
		reference,
		end,
	};
}

function collectReferences(lines: string[], gfm: boolean): References {
	const references = new Map<string, Reference>() as References;
	references.gfm = gfm;
	let lastDefinitionEnd = -2;
	for (let index = 0; index < lines.length; index++) {
		const fence = lines[index].match(/^ {0,3}(`{3,}|~{3,})/);
		if (fence) {
			const marker = fence[1][0];
			const size = fence[1].length;
			while (
				++index < lines.length &&
				!new RegExp(`^ {0,3}${marker}{${size},}[ \\t]*$`).test(lines[index])
			) {
				// Reference-like text inside code is literal.
			}
			continue;
		}
		if (/^ {0,3}>/.test(lines[index])) {
			const quoted: string[] = [];
			let cursor = index;
			while (cursor < lines.length) {
				const match = lines[cursor].match(/^ {0,3}>[ \t]?(.*)$/);
				if (!match) break;
				quoted.push(match[1]);
				cursor++;
			}
			for (const [key, reference] of collectReferences(quoted, gfm)) {
				if (!references.has(key)) references.set(key, reference);
			}
			index = cursor - 1;
			continue;
		}
		if (
			index > 0 && lines[index - 1].trim() !== "" &&
			lastDefinitionEnd !== index - 1 &&
			!isAtxHeading(lines[index - 1]) &&
			!isThematicBreak(lines[index - 1])
		) continue;
		const definition = parseReferenceDefinition(lines, index);
		if (definition) {
			if (!references.has(definition.key)) {
				references.set(definition.key, definition.reference);
			}
			lastDefinitionEnd = definition.end;
			index = definition.end;
		}
	}
	return references;
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

		const referenceDefinition = parseReferenceDefinition(lines, index);
		if (referenceDefinition) {
			index = referenceDefinition.end + 1;
			continue;
		}

		if (
			allowFrontmatter && index === 0 && line === "---" &&
			lines.indexOf("---", 1) > 0 &&
			lines.slice(1, lines.indexOf("---", 1)).some((value) =>
				/^[A-Za-z_][\w-]*\s*:/.test(value)
			)
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
		if (
			fence &&
			(fence[1][0] !== "`" || !`${fence[2]}${fence[3]}`.includes("`"))
		) {
			const marker = fence[1][0];
			const size = fence[1].length;
			const fenceIndent = line.match(/^ */)?.[0].length ?? 0;
			const body: string[] = [];
			let cursor = index + 1;
			while (
				cursor < lines.length &&
				!new RegExp(`^ {0,3}${marker === "`" ? "`" : "~"}{${size},}[ \\t]*$`)
					.test(lines[cursor])
			) {
				if (!(cursor === lines.length - 1 && lines[cursor] === "")) {
					const indentation = lines[cursor].match(/^ */)?.[0].length ?? 0;
					body.push(lines[cursor].slice(Math.min(fenceIndent, indentation)));
				}
				cursor++;
			}
			output.push({
				type: "code-block",
				language: fence[2] ? decodeMarkdownString(fence[2]) : undefined,
				meta: fence[3] ? decodeMarkdownString(fence[3]) : undefined,
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
			const content = (heading[2] ?? "").replace(
				/(?:^|[ \t]+)#+[ \t]*$/,
				"",
			);
			output.push({
				type: "h",
				size: heading[1].length,
				content: parseInlines(content, references),
			});
			index++;
			if (index < lines.length) output.push("\n");
			continue;
		}

		let setextEnd = index + 1;
		while (
			setextEnd < lines.length &&
			lines[setextEnd].trim() !== "" &&
			!/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[setextEnd]) &&
			!isFence(lines[setextEnd]) && !isAtxHeading(lines[setextEnd]) &&
			!isThematicBreak(lines[setextEnd]) &&
			!/^ {0,3}>/.test(lines[setextEnd]) &&
			!listMatch(lines[setextEnd]) && !isHtmlBlock(lines[setextEnd])
		) setextEnd++;
		if (
			setextEnd < lines.length &&
			/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[setextEnd]) &&
			line.trim() && !/^ {0,3}>/.test(line) && !listMatch(line) &&
			!isThematicBreak(line)
		) {
			output.push({
				type: "h",
				size: lines[setextEnd].trimStart().startsWith("=") ? 1 : 2,
				content: parseInlines(
					lines.slice(index, setextEnd).map((value) =>
						value.replace(/^ {0,3}/, "").trimEnd()
					).join("\n"),
					references,
				),
			});
			index = setextEnd + 1;
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
			let lazyAllowed = false;
			while (cursor < lines.length) {
				const quote = lines[cursor].match(/^ {0,3}>[ \t]?(.*)$/);
				if (quote) {
					quoteLines.push(quote[1]);
					if (quote[1].trim() === "") {
						lazyAllowed = false;
					} else lazyAllowed = containerLeafIsParagraph(quote[1]);
				} else if (
					lazyAllowed && lines[cursor].trim() !== "" &&
					!isThematicBreak(lines[cursor]) &&
					!isAtxHeading(lines[cursor]) &&
					!isFence(lines[cursor]) &&
					!listMatch(lines[cursor])
				) {
					const lazy = lines[cursor].replace(/^ {0,4}/, "");
					quoteLines.push(
						/^ {0,3}(?:=+|-+)[ \t]*$/.test(lazy)
							? lazy.replace(/^./, (char) => `&#${char.codePointAt(0)};`)
							: /^[-+*]\s/.test(lazy)
							? `\\${lazy}`
							: lazy,
					);
				} else break;
				cursor++;
			}
			const blocks = parseBlocks(quoteLines, references, false);
			const meaningful = blocks.filter((node) => node !== "\n");
			const only = meaningful[0];
			const content = meaningful.length === 0
				? []
				: meaningful.length === 1 && typeof only !== "string" &&
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
			const markerStyle = ordered ? list[2].at(-1) : list[2];
			let listLoose = false;
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
					(ordered ? item[2].at(-1) : item[2]) !== markerStyle ||
					isThematicBreak(lines[cursor])
				) break;

				const itemLines = [item[4] ?? ""];
				const contentIndent = item[1].length + item[2].length + item[3].length;
				cursor++;
				while (cursor < lines.length) {
					const currentIndent = lines[cursor].match(/^[ \t]*/)?.[0].length ?? 0;
					if (
						isThematicBreak(lines[cursor]) &&
						currentIndent < contentIndent
					) break;
					const nextItem = listMatch(lines[cursor]);
					if (
						nextItem && /^\d/.test(nextItem[2]) === ordered &&
						(ordered ? nextItem[2].at(-1) : nextItem[2]) ===
							markerStyle &&
						nextItem[1].length < contentIndent
					) break;
					if (lines[cursor].trim() === "") {
						let afterBlankIndex = cursor + 1;
						while (
							afterBlankIndex < lines.length &&
							lines[afterBlankIndex].trim() === ""
						) afterBlankIndex++;
						const afterBlank = lines[afterBlankIndex];
						const followingItem = afterBlank === undefined
							? null
							: listMatch(afterBlank);
						const followingIndent = afterBlank?.match(/^[ \t]*/)?.[0].length ??
							0;
						const sameLevelItem = !!followingItem &&
							/^\d/.test(followingItem[2]) === ordered &&
							(ordered ? followingItem[2].at(-1) : followingItem[2]) ===
								markerStyle &&
							followingItem[1].length < contentIndent;
						if (
							itemLines.length === 1 && itemLines[0] === "" &&
							!sameLevelItem
						) break;
						if (
							afterBlank !== undefined &&
							(sameLevelItem ||
								followingIndent >= contentIndent)
						) {
							if (sameLevelItem) listLoose = true;
							while (cursor < afterBlankIndex) {
								itemLines.push("");
								cursor++;
							}
							continue;
						}
						break;
					}
					const indentation = currentIndent;
					if (
						nextItem && indentation < contentIndent
					) break;
					if (indentation <= markerColumn && isBlockStart(lines, cursor)) break;
					itemLines.push(
						lines[cursor].startsWith(" ".repeat(contentIndent))
							? lines[cursor].slice(contentIndent)
							: indentation < contentIndent &&
									/^ {4,}[-+*]\s/.test(lines[cursor])
							? `\\${lines[cursor].trimStart()}`
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
				...(listLoose ? { loose: true } : {}),
				items,
			});
			index = cursor;
			if (index < lines.length) output.push("\n");
			continue;
		}

		if (
			index + 1 < lines.length && line.includes("|") &&
			isTableDelimiter(lines[index + 1]) &&
			splitTableRow(line).length === splitTableRow(lines[index + 1]).length
		) {
			const headers = splitTableRow(line);
			const delimiter = splitTableRow(lines[index + 1]);
			const rows: InlineNode[][][] = [];
			let cursor = index + 2;
			while (
				cursor < lines.length && lines[cursor].trim() &&
				!isBlockStart(lines, cursor)
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

		const htmlKind = htmlBlockKind(line);
		if (htmlKind !== null) {
			const body = [line];
			let cursor = index + 1;
			const terminator = htmlKind === 1
				? /<\/(?:script|pre|style|textarea)>/i
				: htmlKind === 2
				? /-->/
				: htmlKind === 3
				? /\?>/
				: htmlKind === 4
				? />/
				: htmlKind === 5
				? /\]\]>/
				: null;
			let finished = terminator?.test(line) ?? false;
			while (
				cursor < lines.length && !finished &&
				(terminator !== null || lines[cursor].trim() !== "")
			) {
				if (!(cursor === lines.length - 1 && lines[cursor] === "")) {
					body.push(lines[cursor]);
				}
				finished = terminator?.test(lines[cursor]) ?? false;
				cursor++;
			}
			output.push({ type: "html", content: body.join("\n"), block: true });
			index = cursor;
			if (index < lines.length) output.push("\n");
			continue;
		}

		const paragraph = [line.replace(/^ {0,3}/, "")];
		let cursor = index + 1;
		while (
			cursor < lines.length &&
			(!isBlockStart(lines, cursor) || /^(?: {4}|\t)/.test(lines[cursor]))
		) {
			paragraph.push(lines[cursor].trimStart());
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

type MarkdownState = {
	references: References;
	gfm: boolean;
};

function expandStructuralTabs(line: string): string {
	let output = "";
	let offset = 0;
	let column = 0;
	const whitespace = () => {
		while (offset < line.length && /[ \t]/.test(line[offset])) {
			if (line[offset] === "\t") {
				const width = 4 - (column % 4);
				output += " ".repeat(width);
				column += width;
			} else {
				output += " ";
				column++;
			}
			offset++;
		}
	};
	whitespace();
	for (let depth = 0; depth < 32 && offset < line.length; depth++) {
		const rest = line.slice(offset);
		const marker = rest.match(/^(?:>|[-+*]|\d{1,9}[.)])/);
		if (!marker) break;
		const after = line[offset + marker[0].length];
		if (marker[0] !== ">" && after !== " " && after !== "\t") break;
		output += marker[0];
		column += marker[0].length;
		offset += marker[0].length;
		whitespace();
	}
	return output + line.slice(offset);
}

function createMarkdownParser(gfm: boolean) {
	return createSourceParser<BlockNode[], MarkdownState>(
		(context: SourceContext<MarkdownState>) => {
			const source = context.cursor.advance(context.cursor.remaining.length);
			const normalized = source.replace(/\r\n?/g, "\n");
			const lines = normalized.split("\n").map(expandStructuralTabs);
			context.state.references = collectReferences(lines, context.state.gfm);
			return [parseBlocks(lines, context.state.references), null];
		},
		() => {
			const references = new Map<string, Reference>() as References;
			references.gfm = gfm;
			return { references, gfm };
		},
	);
}

const commonMarkdownParser = createMarkdownParser(false);
const gfmMarkdownParser = createMarkdownParser(true);

/**
 * Parse Markdown into a compact AST. Text remains as strings for compatibility
 * with the original Nanolex Markdown example.
 */
export type MarkdownParseOptions = {
	gfm?: boolean;
};

export function parser(
	input: string,
	options: MarkdownParseOptions = {},
): BlockNode[] {
	return (options.gfm === false ? commonMarkdownParser : gfmMarkdownParser)(
		input,
	);
}

export const parseMarkdown = parser;

function escapeHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function normalizeUri(value: string): string {
	try {
		return encodeURI(value).replace(/%25([\dA-F]{2})/gi, "%$1");
	} catch {
		return value;
	}
}

function renderInlines(nodes: InlineNode[]): string {
	let output = "";
	for (const node of nodes) {
		if (typeof node === "string") {
			output += escapeHtml(node);
			continue;
		}
		switch (node.type) {
			case "b":
				output += `<strong>${renderInlines(node.content)}</strong>`;
				break;
			case "i":
				output += `<em>${renderInlines(node.content)}</em>`;
				break;
			case "s":
				output += `<del>${renderInlines(node.content)}</del>`;
				break;
			case "c":
				output += `<code>${escapeHtml(node.content.join(""))}</code>`;
				break;
			case "a":
				output += `<a href="${escapeHtml(normalizeUri(node.href))}"${
					node.title === undefined ? "" : ` title="${escapeHtml(node.title)}"`
				}>${renderInlines(node.content)}</a>`;
				break;
			case "img":
				output += `<img src="${escapeHtml(normalizeUri(node.src))}" alt="${
					escapeHtml(node.alt)
				}"${
					node.title === undefined ? "" : ` title="${escapeHtml(node.title)}"`
				} />`;
				break;
			case "br":
				output += "<br />\n";
				break;
			case "html":
				output += node.content;
				break;
		}
	}
	return output;
}

function hasBlockNode(
	nodes: InlineNode[] | BlockNode[],
): nodes is BlockNode[] {
	return nodes.some((node) =>
		typeof node !== "string" &&
		(["p", "h", "q", "ul", "ol", "code-block", "hr", "table", "frontmatter"]
			.includes(node.type) ||
			(node.type === "html" && "block" in node && node.block === true))
	);
}

function listIsLoose(
	items: Array<{ content: BlockNode[] }>,
): boolean {
	return items.some((item) => {
		let blank = false;
		let previousBreak = false;
		let paragraphs = 0;
		for (const node of item.content) {
			if (node === "\n") {
				if (previousBreak) blank = true;
				previousBreak = true;
			} else {
				previousBreak = false;
				if (typeof node !== "string" && node.type === "p") paragraphs++;
			}
		}
		return blank || paragraphs > 1;
	});
}

export type MarkdownRenderOptions = {
	gfm?: boolean;
};

function renderListBlocks(
	nodes: BlockNode[],
	tight: boolean,
	options: MarkdownRenderOptions,
): string {
	let output = "";
	for (const node of nodes) {
		if (node === "\n") continue;
		if (
			tight && typeof node !== "string" && node.type === "p"
		) {
			output += renderInlines(node.content);
		} else {
			if (tight && output && !output.endsWith("\n")) output += "\n";
			output += renderMarkdown([node], options);
		}
	}
	return output;
}

/** Render the compact Markdown AST to CommonMark-style HTML. */
export function renderMarkdown(
	nodes: BlockNode[],
	options: MarkdownRenderOptions = {},
): string {
	let output = "";
	for (const node of nodes) {
		if (typeof node === "string") {
			if (node !== "\n") output += escapeHtml(node);
			continue;
		}
		switch (node.type) {
			case "p":
				output += `<p>${renderInlines(node.content)}</p>\n`;
				break;
			case "h":
				output += `<h${node.size}>${
					renderInlines(node.content)
				}</h${node.size}>\n`;
				break;
			case "q": {
				const content = node.content;
				const body = content.length === 0
					? ""
					: hasBlockNode(content)
					? renderMarkdown(content, options)
					: `<p>${renderInlines(content as InlineNode[])}</p>\n`;
				output += `<blockquote>\n${body}</blockquote>\n`;
				break;
			}
			case "ul":
			case "ol": {
				const start = node.type === "ol" && node.start !== undefined &&
						node.start !== 1
					? ` start="${node.start}"`
					: "";
				const tight = !node.loose && !listIsLoose(node.items);
				output += `<${node.type}${start}>\n`;
				for (const item of node.items) {
					const task = item.checked === undefined
						? ""
						: `<input type="checkbox"${
							item.checked ? ' checked=""' : ""
						} disabled="" /> `;
					const content = task +
						renderListBlocks(item.content, tight, options);
					const first = item.content.find((value) => value !== "\n");
					const blockFirst = first !== undefined &&
						typeof first !== "string" && first.type !== "p";
					output += `<li>${
						content && (!tight || blockFirst) ? "\n" : ""
					}${content}</li>\n`;
				}
				output += `</${node.type}>\n`;
				break;
			}
			case "code-block": {
				const language = node.language
					? ` class="language-${escapeHtml(node.language)}"`
					: "";
				output += `<pre><code${language}>${
					escapeHtml(node.content)
				}</code></pre>\n`;
				break;
			}
			case "hr":
				output += "<hr />\n";
				break;
			case "table":
				output += "<table>\n<thead>\n<tr>\n";
				for (let index = 0; index < node.header.length; index++) {
					const align = node.align[index]
						? ` align="${node.align[index]}"`
						: "";
					output += `<th${align}>${renderInlines(node.header[index])}</th>\n`;
				}
				output += `</tr>\n</thead>\n${
					node.rows.length === 0 ? "" : "<tbody>\n"
				}`;
				for (const row of node.rows) {
					output += "<tr>\n";
					for (let index = 0; index < row.length; index++) {
						const align = node.align[index]
							? ` align="${node.align[index]}"`
							: "";
						output += `<td${align}>${renderInlines(row[index])}</td>\n`;
					}
					output += "</tr>\n";
				}
				output += `${node.rows.length === 0 ? "" : "</tbody>\n"}</table>\n`;
				break;
			case "html":
				output += `${
					options.gfm
						? node.content.replace(
							/<(?=\/?(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?:\s|>|\/))/gi,
							"&lt;",
						)
						: node.content
				}\n`;
				break;
			case "frontmatter":
				break;
		}
	}
	return output;
}
