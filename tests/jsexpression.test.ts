import { assertEquals } from "https://deno.land/std@0.215.0/assert/mod.ts";
// import { assertSnapshot } from "testing/snapshot.ts";

import { parser } from "./jsexpression.ts";

Deno.test(`parses "1"`, () => {
	assertEquals(parser("1"), { type: "Literal", raw: "1" });
});

Deno.test(`parses "1+1"`, () => {
	assertEquals(parser("1+1"), {
		type: "BinaryExpression",
		operator: "+",
		left: { type: "Literal", raw: "1" },
		right: { type: "Literal", raw: "1" },
	});
});

Deno.test(`parses "1  + 1"`, () => {
	assertEquals(parser("1  + 1"), {
		type: "BinaryExpression",
		operator: "+",
		left: { type: "Literal", raw: "1" },
		right: { type: "Literal", raw: "1" },
	});
});

Deno.test(`parses "1 + 2 + 3"`, () => {
	assertEquals(parser("1 + 2 + 3"), {
		type: "BinaryExpression",
		operator: "+",
		left: { type: "Literal", raw: "1" },
		right: {
			type: "BinaryExpression",
			operator: "+",
			left: { type: "Literal", raw: "2" },
			right: { type: "Literal", raw: "3" },
		},
	});
});
