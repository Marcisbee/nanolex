// deno-lint-ignore-file no-import-prefix
import {
	assertEquals,
	assertThrows,
} from "https://deno.land/std@0.215.0/assert/mod.ts";

import { parseFormula } from "./formula.ts";

Deno.test("parses literals and escaped strings", () => {
	assertEquals(parseFormula(`={1,-2.5,3E+2;"say ""hi""",TRUE,#N/A}`), {
		type: "array",
		rows: [
			[
				{ type: "number", value: 1, raw: "1" },
				{
					type: "unary",
					operator: "-",
					argument: { type: "number", value: 2.5, raw: "2.5" },
				},
				{ type: "number", value: 300, raw: "3E+2" },
			],
			[
				{ type: "string", value: 'say "hi"' },
				{ type: "boolean", value: true },
				{ type: "error", value: "#N/A" },
			],
		],
	});
});

Deno.test("parses absolute, qualified, and quoted-sheet ranges", () => {
	assertEquals(parseFormula(`='Q1 Sales'!$B$2:Sheet2!C10`), {
		type: "range",
		from: {
			type: "reference",
			sheet: "Q1 Sales",
			column: "B",
			row: 2,
			columnAbsolute: true,
			rowAbsolute: true,
		},
		to: {
			type: "reference",
			sheet: "Sheet2",
			column: "C",
			row: 10,
			columnAbsolute: false,
			rowAbsolute: false,
		},
	});
});

Deno.test("parses whole-column and whole-row ranges", () => {
	assertEquals(parseFormula("=Data!$A:C"), {
		type: "range",
		from: {
			type: "column-reference",
			sheet: "Data",
			column: "A",
			absolute: true,
		},
		to: {
			type: "column-reference",
			sheet: "Data",
			column: "C",
			absolute: false,
		},
	});
	assertEquals(parseFormula("=$1:$10"), {
		type: "range",
		from: { type: "row-reference", row: 1, absolute: true },
		to: { type: "row-reference", row: 10, absolute: true },
	});
});

Deno.test("parses nested functions and missing arguments", () => {
	assertEquals(parseFormula(`=IF(A1>0,SUM(A1:A10,,5),"none")`), {
		type: "call",
		name: "IF",
		arguments: [
			{
				type: "binary",
				operator: ">",
				left: {
					type: "reference",
					column: "A",
					row: 1,
					columnAbsolute: false,
					rowAbsolute: false,
				},
				right: { type: "number", value: 0, raw: "0" },
			},
			{
				type: "call",
				name: "SUM",
				arguments: [
					{
						type: "range",
						from: {
							type: "reference",
							column: "A",
							row: 1,
							columnAbsolute: false,
							rowAbsolute: false,
						},
						to: {
							type: "reference",
							column: "A",
							row: 10,
							columnAbsolute: false,
							rowAbsolute: false,
						},
					},
					{ type: "missing" },
					{ type: "number", value: 5, raw: "5" },
				],
			},
			{ type: "string", value: "none" },
		],
	});
});

Deno.test("applies spreadsheet operator precedence and associativity", () => {
	assertEquals(parseFormula('=-2^2+3*4&"x"=8'), {
		type: "binary",
		operator: "=",
		left: {
			type: "binary",
			operator: "&",
			left: {
				type: "binary",
				operator: "+",
				left: {
					type: "unary",
					operator: "-",
					argument: {
						type: "binary",
						operator: "^",
						left: { type: "number", value: 2, raw: "2" },
						right: { type: "number", value: 2, raw: "2" },
					},
				},
				right: {
					type: "binary",
					operator: "*",
					left: { type: "number", value: 3, raw: "3" },
					right: { type: "number", value: 4, raw: "4" },
				},
			},
			right: { type: "string", value: "x" },
		},
		right: { type: "number", value: 8, raw: "8" },
	});

	const power = parseFormula("=2^3^2");
	assertEquals(power, {
		type: "binary",
		operator: "^",
		left: { type: "number", value: 2, raw: "2" },
		right: {
			type: "binary",
			operator: "^",
			left: { type: "number", value: 3, raw: "3" },
			right: { type: "number", value: 2, raw: "2" },
		},
	});
});

Deno.test("parses percent, spill, implicit intersection, and names", () => {
	assertEquals(parseFormula("=@Revenue#*10%"), {
		type: "binary",
		operator: "*",
		left: {
			type: "unary",
			operator: "@",
			argument: {
				type: "postfix",
				operator: "#",
				argument: { type: "name", name: "Revenue" },
			},
		},
		right: {
			type: "postfix",
			operator: "%",
			argument: { type: "number", value: 10, raw: "10" },
		},
	});
});

Deno.test("parses table structured references", () => {
	assertEquals(
		parseFormula("=SUM(Sales[[#Data],[Net Amount]])+[@Tax]"),
		{
			type: "binary",
			operator: "+",
			left: {
				type: "call",
				name: "SUM",
				arguments: [{
					type: "structured-reference",
					table: "Sales",
					specifier: "[[#Data],[Net Amount]]",
				}],
			},
			right: {
				type: "structured-reference",
				specifier: "[@Tax]",
			},
		},
	);
});

Deno.test("accepts semicolon argument separators", () => {
	assertEquals(parseFormula("=ROUND(1.25;1)"), {
		type: "call",
		name: "ROUND",
		arguments: [
			{ type: "number", value: 1.25, raw: "1.25" },
			{ type: "number", value: 1, raw: "1" },
		],
	});
});

Deno.test("rejects incomplete formulas", () => {
	assertThrows(
		() => parseFormula("=SUM(A1:A10"),
		Error,
		"Parse error",
	);
	assertThrows(
		() => parseFormula("=1+"),
		Error,
		"Parse error",
	);
});
