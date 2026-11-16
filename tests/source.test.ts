// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { expect } from "jsr:@std/expect";

import {
	createSourceParser,
	SourceCursor,
	sourceLiteral,
	sourcePattern,
	transactional,
} from "../src/nanolex.ts";

Deno.test("SourceCursor supports lexer-free matching and checkpoints", () => {
	const cursor = new SourceCursor("fence```tail");
	expect(cursor.consume("fence")).toBe("fence");
	const checkpoint = cursor.checkpoint();
	expect(cursor.match(/`+/)?.[0]).toBe("```");
	cursor.restore(checkpoint);
	expect(cursor.advance(3)).toBe("```");
	expect(cursor.remaining).toBe("tail");
});

Deno.test("transactional source grammars restore cursor and cloned state", () => {
	const grammar = transactional(
		(context: { cursor: SourceCursor; state: { values: string[] } }) => {
			context.cursor.advance(1);
			context.state.values.push("changed");
			return [null, { offset: 1, expected: "success" }] as const;
		},
		(state) => ({ values: [...state.values] }),
	);
	const cursor = new SourceCursor("x");
	const context = { cursor, state: { values: [] as string[] } };
	expect(grammar(context)[1]?.expected).toBe("success");
	expect(cursor.offset).toBe(0);
	expect(context.state.values).toEqual([]);
});

Deno.test("createSourceParser isolates per-parse state", () => {
	const parse = createSourceParser(
		(context: { cursor: SourceCursor; state: { calls: number } }) => {
			context.state.calls++;
			const literal = sourceLiteral<{ calls: number }>("id")(context);
			if (literal[1]) return literal;
			const number = sourcePattern<{ calls: number }>(/\d+/)(context);
			if (number[1]) return number;
			return [`${context.state.calls}:${number[0][0]}`, null] as const;
		},
		() => ({ calls: 0 }),
	);
	expect(parse("id42")).toBe("1:42");
	expect(parse("id7")).toBe("1:7");
});

Deno.test("source regex matching cannot skip to a later line", () => {
	const pattern = /b$/gmy;
	pattern.lastIndex = 2;
	const cursor = new SourceCursor("xa\nb");
	cursor.advance();
	expect(cursor.match(pattern)).toBeNull();
	expect(cursor.offset).toBe(1);
	cursor.advance(2);
	expect(cursor.match(pattern)?.[0]).toBe("b");
	expect(cursor.eof).toBe(true);
	expect(pattern.lastIndex).toBe(2);

});

Deno.test("sourcePattern rejects later-line matches and resets between calls", () => {
	const pattern = /b$/gmy;
	const match = sourcePattern(pattern);
	const context = { cursor: new SourceCursor("xa\nb"), state: undefined };
	context.cursor.advance();
	expect(match(context)).toEqual([null, { offset: 1, expected: "b$" }]);
	expect(context.cursor.offset).toBe(1);
	context.cursor.advance(2);
	expect(match(context)[0]?.[0]).toBe("b");
	context.cursor.restore(3);
	expect(match(context)[0]?.[0]).toBe("b");

	const parse = createSourceParser(sourcePattern(/b$/m));
	expect(() => parse("a\nb")).toThrow("Parse error: expected b$ at 0");
	expect(parse("b")[0]).toBe("b");
});
