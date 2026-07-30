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

Deno.test("parses range, intersection, and union reference operators", () => {
	assertEquals(parseFormula("=B7:D7 C6:C8"), {
		type: "intersection",
		left: {
			type: "range",
			from: {
				type: "reference",
				column: "B",
				row: 7,
				columnAbsolute: false,
				rowAbsolute: false,
			},
			to: {
				type: "reference",
				column: "D",
				row: 7,
				columnAbsolute: false,
				rowAbsolute: false,
			},
		},
		right: {
			type: "range",
			from: {
				type: "reference",
				column: "C",
				row: 6,
				columnAbsolute: false,
				rowAbsolute: false,
			},
			to: {
				type: "reference",
				column: "C",
				row: 8,
				columnAbsolute: false,
				rowAbsolute: false,
			},
		},
	});

	const union = parseFormula("=(A1:A3,C1:C3,E1:E3)");
	assertEquals(union.type, "union");
	if (union.type !== "union") throw new Error("Expected union");
	assertEquals(union.left.type, "union");
	assertEquals(union.right.type, "range");
});

Deno.test("parses 3-D, external workbook, and invalid references", () => {
	assertEquals(parseFormula("=Sheet1:Sheet3!A1"), {
		type: "reference",
		sheet: "Sheet1",
		sheetTo: "Sheet3",
		column: "A",
		row: 1,
		columnAbsolute: false,
		rowAbsolute: false,
	});
	assertEquals(parseFormula(`='C:\\Reports\\[Budget.xlsx]Q1 Sales'!$B$2`), {
		type: "reference",
		external: "C:\\Reports\\",
		workbook: "Budget.xlsx",
		sheet: "Q1 Sales",
		column: "B",
		row: 2,
		columnAbsolute: true,
		rowAbsolute: true,
	});
	assertEquals(parseFormula("=Sheet1!#REF!"), {
		type: "invalid-reference",
		sheet: "Sheet1",
	});
});

Deno.test("parses R1C1 cells, rows, columns, and ranges", () => {
	assertEquals(parseFormula("=R[-2]C[3]:R2C4"), {
		type: "range",
		from: {
			type: "r1c1-reference",
			row: { mode: "relative", value: -2 },
			column: { mode: "relative", value: 3 },
		},
		to: {
			type: "r1c1-reference",
			row: { mode: "absolute", value: 2 },
			column: { mode: "absolute", value: 4 },
		},
	});
	assertEquals(parseFormula("=R[-1]"), {
		type: "r1c1-reference",
		row: { mode: "relative", value: -1 },
	});
	assertEquals(parseFormula("=C[2]"), {
		type: "r1c1-reference",
		column: { mode: "relative", value: 2 },
	});
});

Deno.test("parses linked-data fields and LAMBDA invocation", () => {
	assertEquals(parseFormula("=A1.Price"), {
		type: "field",
		object: {
			type: "reference",
			column: "A",
			row: 1,
			columnAbsolute: false,
			rowAbsolute: false,
		},
		field: "Price",
	});
	assertEquals(parseFormula("=LAMBDA(x,x+1)(5)").type, "invoke");
	assertEquals(parseFormula("=A1.[52 Week High]"), {
		type: "field",
		object: {
			type: "reference",
			column: "A",
			row: 1,
			columnAbsolute: false,
			rowAbsolute: false,
		},
		field: "52 Week High",
	});
});

Deno.test("covers modern and legacy spreadsheet formula syntax", () => {
	const formulas = [
		"=SUM(A1:A10 B5:B15)",
		"=SUM((A1:A3,C1:C3))",
		"=A1:INDEX(A:A,10)",
		"=Sheet1:Sheet3!A1:B20",
		"='O''Brien'!A1",
		"=[Budget.xlsx]Sheet1!A1",
		"=R1C1:R10C5",
		"=RC+R[-1]C",
		"=Table1[[#Headers],[Amount]]",
		"=Table1[[#Data],[First]:[Last]]",
		"=@Table1[Amount]",
		"=SUM(A1#)",
		"=LET(rate,0.2,LAMBDA(x,x*rate)(A1))",
		'=_xlfn.XLOOKUP(A1,B:B,C:C,"missing")',
		"=IF(A1,,B1,)",
		'={1,-2.5,TRUE;#N/A,"text"}',
		"{=SUM(A1:A3*B1:B3)}",
		"=Sheet1!LocalName",
		"=personal.xlsb!discount()",
		"=10%+2^3^2",
		'="say ""hello"""&A1',
		"=#FIELD!",
		"=#BLOCKED!",
		"=#CONNECT!",
		"=#BUSY!",
		"=#UNKNOWN!",
		"=#PYTHON!",
		"=#TIMEOUT!",
	];
	for (const formula of formulas) parseFormula(formula);
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
