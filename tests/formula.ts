import {
	and,
	consume,
	createParser,
	createToken,
	type Grammar,
	or,
	rule,
	skipIn,
	zeroOrMany,
	zeroOrManySep,
	zeroOrOne,
} from "../src/nanolex.ts";

export interface NumberLiteral {
	type: "number";
	value: number;
	raw: string;
}

export interface StringLiteral {
	type: "string";
	value: string;
}

export interface BooleanLiteral {
	type: "boolean";
	value: boolean;
}

export interface ErrorLiteral {
	type: "error";
	value: string;
}

export interface ReferenceQualifier {
	workbook?: string;
	sheet?: string;
	sheetTo?: string;
	external?: string;
}

export interface CellReference {
	type: "reference";
	sheet?: string;
	sheetTo?: string;
	workbook?: string;
	external?: string;
	column: string;
	row: number;
	columnAbsolute: boolean;
	rowAbsolute: boolean;
}

export interface ColumnReference {
	type: "column-reference";
	sheet?: string;
	sheetTo?: string;
	workbook?: string;
	external?: string;
	column: string;
	absolute: boolean;
}

export interface RowReference {
	type: "row-reference";
	sheet?: string;
	sheetTo?: string;
	workbook?: string;
	external?: string;
	row: number;
	absolute: boolean;
}

export interface R1C1Axis {
	mode: "absolute" | "relative" | "current";
	value?: number;
}

export interface R1C1Reference {
	type: "r1c1-reference";
	sheet?: string;
	sheetTo?: string;
	workbook?: string;
	external?: string;
	row?: R1C1Axis;
	column?: R1C1Axis;
}

export interface InvalidReference {
	type: "invalid-reference";
	sheet?: string;
	sheetTo?: string;
	workbook?: string;
	external?: string;
}

export type Reference =
	| CellReference
	| ColumnReference
	| RowReference
	| R1C1Reference
	| InvalidReference;

export interface RangeExpression {
	type: "range";
	from: ReferenceExpression;
	to: ReferenceExpression;
}

export interface UnionExpression {
	type: "union";
	left: FormulaNode;
	right: FormulaNode;
}

export interface IntersectionExpression {
	type: "intersection";
	left: FormulaNode;
	right: FormulaNode;
}

export interface NameExpression {
	type: "name";
	name: string;
	sheet?: string;
	sheetTo?: string;
	workbook?: string;
	external?: string;
}

export interface StructuredReference {
	type: "structured-reference";
	table?: string;
	specifier: string;
	sheet?: string;
	sheetTo?: string;
	workbook?: string;
	external?: string;
}

export interface MissingArgument {
	type: "missing";
}

export interface CallExpression {
	type: "call";
	name: string;
	arguments: (FormulaNode | MissingArgument)[];
	sheet?: string;
	sheetTo?: string;
	workbook?: string;
	external?: string;
}

export interface InvocationExpression {
	type: "invoke";
	callee: FormulaNode;
	arguments: (FormulaNode | MissingArgument)[];
}

export interface UnaryExpression {
	type: "unary";
	operator: "+" | "-" | "@";
	argument: FormulaNode;
}

export interface PostfixExpression {
	type: "postfix";
	operator: "%" | "#";
	argument: FormulaNode;
}

export interface FieldExpression {
	type: "field";
	object: FormulaNode;
	field: string;
}

export interface BinaryExpression {
	type: "binary";
	operator:
		| "+"
		| "-"
		| "*"
		| "/"
		| "^"
		| "&"
		| "="
		| "<>"
		| "<"
		| ">"
		| "<="
		| ">=";
	left: FormulaNode;
	right: FormulaNode;
}

export interface ArrayLiteral {
	type: "array";
	rows: FormulaNode[][];
}

export interface LegacyArrayFormula {
	type: "legacy-array-formula";
	expression: FormulaNode;
}

export type ReferenceExpression =
	| Reference
	| NameExpression
	| StructuredReference
	| CallExpression
	| InvocationExpression
	| PostfixExpression
	| RangeExpression
	| UnionExpression
	| IntersectionExpression;

export type FormulaNode =
	| NumberLiteral
	| StringLiteral
	| BooleanLiteral
	| ErrorLiteral
	| CellReference
	| ColumnReference
	| RowReference
	| R1C1Reference
	| InvalidReference
	| RangeExpression
	| UnionExpression
	| IntersectionExpression
	| NameExpression
	| StructuredReference
	| CallExpression
	| InvocationExpression
	| UnaryExpression
	| PostfixExpression
	| FieldExpression
	| BinaryExpression
	| ArrayLiteral
	| LegacyArrayFormula;

type BinaryOperator = BinaryExpression["operator"];

const Whitespace = createToken(/[ \t\r\n]+/, "Whitespace");
const StringToken = createToken(/"(?:""|[^"])*"/, "String");
const QualifierToken = createToken(
	/(?:'(?:''|[^'])*'|(?:\[[^\]]+\])?[A-Za-z0-9_\u0080-\uFFFF][A-Za-z0-9_.\u0080-\uFFFF]*(?::[A-Za-z0-9_\u0080-\uFFFF][A-Za-z0-9_.\u0080-\uFFFF]*)?)!/,
	"SheetOrWorkbookQualifier",
);
const StructuredReferenceToken = createToken(
	/(?:[A-Za-z_\\][A-Za-z0-9_.\\]*)?\[(?:[^[\]]|\[[^[\]]*\])*\]/,
	"StructuredReference",
);
const ErrorToken = createToken(
	/#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!|GETTING_DATA|FIELD!|BLOCKED!|CONNECT!|BUSY!|UNKNOWN!|PYTHON!|TIMEOUT!)/,
	"Error",
);
const WholeColumnRange = createToken(
	/\$?[A-Za-z]{1,3}[ \t]*:[ \t]*\$?[A-Za-z]{1,3}/,
	"ColumnRange",
);
const WholeRowRange = createToken(
	/\$?[1-9]\d*[ \t]*:[ \t]*\$?[1-9]\d*/,
	"RowRange",
);
const Cell = createToken(/\$?[A-Za-z]{1,3}\$?[1-9]\d*/, "Cell");
const R1C1Cell = createToken(
	/R(?:\[-?\d+\]|\d*)C(?:\[-?\d+\]|\d*)/,
	"R1C1Cell",
);
const R1C1Row = createToken(/R(?:\[-?\d+\]|\d+)/, "R1C1Row");
const R1C1Column = createToken(/C(?:\[-?\d+\]|\d+)/, "R1C1Column");
const BooleanToken = createToken(
	/(?:[Tt][Rr][Uu][Ee]|[Ff][Aa][Ll][Ss][Ee])(?![A-Za-z0-9_.])/,
	"Boolean",
);
const NumberToken = createToken(
	/(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/,
	"Number",
);
const Identifier = createToken(
	/[A-Za-z_\u0080-\uFFFF\\][A-Za-z0-9_.?\u0080-\uFFFF\\]*/,
	"Identifier",
);
const Column = createToken(/\$?[A-Za-z]{1,3}/, "Column");

const LessEqual = createToken("<=");
const GreaterEqual = createToken(">=");
const NotEqual = createToken("<>");
const Plus = createToken("+");
const Minus = createToken("-");
const Multiply = createToken("*");
const Divide = createToken("/");
const Power = createToken("^");
const Concat = createToken("&");
const Equal = createToken("=");
const Less = createToken("<");
const Greater = createToken(">");
const Percent = createToken("%");
const Spill = createToken("#");
const ImplicitIntersection = createToken("@");
const LParen = createToken("(");
const RParen = createToken(")");
const LCurly = createToken("{");
const RCurly = createToken("}");
const Comma = createToken(",");
const Semicolon = createToken(";");
const Colon = createToken(":");
const Bang = createToken("!");
const Dot = createToken(".");

const tokens = [
	Whitespace,
	StringToken,
	QualifierToken,
	R1C1Cell,
	R1C1Row,
	R1C1Column,
	ErrorToken,
	WholeColumnRange,
	WholeRowRange,
	Cell,
	StructuredReferenceToken,
	BooleanToken,
	NumberToken,
	Identifier,
	Column,
	LessEqual,
	GreaterEqual,
	NotEqual,
	Plus,
	Minus,
	Multiply,
	Divide,
	Power,
	Concat,
	Equal,
	Less,
	Greater,
	Percent,
	Spill,
	ImplicitIntersection,
	LParen,
	RParen,
	LCurly,
	RCurly,
	Comma,
	Semicolon,
	Colon,
	Bang,
	Dot,
];

const missingArgument: MissingArgument = { type: "missing" };

function parseQualifier(raw: string): ReferenceQualifier {
	let value = raw.slice(0, -1);
	if (value[0] === "'") {
		value = value.slice(1, -1).replaceAll("''", "'");
	}

	const qualifier: ReferenceQualifier = {};
	const workbookStart = value.lastIndexOf("[");
	const workbookEnd = workbookStart < 0
		? -1
		: value.indexOf("]", workbookStart);
	if (workbookStart >= 0 && workbookEnd > workbookStart) {
		const external = value.slice(0, workbookStart);
		if (external) qualifier.external = external;
		qualifier.workbook = value.slice(workbookStart + 1, workbookEnd);
		value = value.slice(workbookEnd + 1);
	}

	const sheetSeparator = value.indexOf(":");
	if (sheetSeparator >= 0) {
		qualifier.sheet = value.slice(0, sheetSeparator);
		qualifier.sheetTo = value.slice(sheetSeparator + 1);
	} else if (value) {
		qualifier.sheet = value;
	}
	return qualifier;
}

function parseCell(
	raw: string,
	qualifier: ReferenceQualifier = {},
): CellReference {
	const match = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/.exec(raw);
	if (!match) {
		throw new Error(`Invalid cell reference: ${raw}`);
	}
	return {
		type: "reference",
		...qualifier,
		column: match[2].toUpperCase(),
		row: Number(match[4]),
		columnAbsolute: match[1] === "$",
		rowAbsolute: match[3] === "$",
	};
}

function parseColumn(
	raw: string,
	qualifier: ReferenceQualifier = {},
): ColumnReference {
	const trimmed = raw.trim();
	return {
		type: "column-reference",
		...qualifier,
		column: trimmed.replace("$", "").toUpperCase(),
		absolute: trimmed[0] === "$",
	};
}

function parseRow(
	raw: string,
	qualifier: ReferenceQualifier = {},
): RowReference {
	const trimmed = raw.trim();
	return {
		type: "row-reference",
		...qualifier,
		row: Number(trimmed.replace("$", "")),
		absolute: trimmed[0] === "$",
	};
}

function parseR1C1Axis(raw: string): R1C1Axis {
	if (!raw) return { mode: "current" };
	if (raw[0] === "[") {
		return {
			mode: "relative",
			value: Number(raw.slice(1, -1)),
		};
	}
	return { mode: "absolute", value: Number(raw) };
}

function parseR1C1(
	raw: string,
	qualifier: ReferenceQualifier = {},
): R1C1Reference {
	const cell = /^R(\[-?\d+\]|\d*)C(\[-?\d+\]|\d*)$/.exec(raw);
	if (cell) {
		return {
			type: "r1c1-reference",
			...qualifier,
			row: parseR1C1Axis(cell[1]),
			column: parseR1C1Axis(cell[2]),
		};
	}
	const axis = /^([RC])(\[-?\d+\]|\d+)$/.exec(raw);
	if (!axis) throw new Error(`Invalid R1C1 reference: ${raw}`);
	return {
		type: "r1c1-reference",
		...qualifier,
		...(axis[1] === "R"
			? { row: parseR1C1Axis(axis[2]) }
			: { column: parseR1C1Axis(axis[2]) }),
	};
}

function parseStructured(
	raw: string,
	qualifier: ReferenceQualifier = {},
): StructuredReference {
	const bracket = raw.indexOf("[");
	return {
		type: "structured-reference",
		...qualifier,
		...(bracket === 0 ? {} : { table: raw.slice(0, bracket) }),
		specifier: raw.slice(bracket),
	};
}

function withInheritedQualifier<T extends ReferenceExpression>(
	node: T,
	qualifier: ReferenceQualifier,
): T {
	const canQualify = node.type === "reference" ||
		node.type === "column-reference" ||
		node.type === "row-reference" ||
		node.type === "r1c1-reference" ||
		node.type === "invalid-reference" ||
		node.type === "name" ||
		node.type === "structured-reference" ||
		node.type === "call";
	if (
		!canQualify ||
		("sheet" in node && node.sheet !== undefined) ||
		(!qualifier.sheet && !qualifier.workbook && !qualifier.external)
	) {
		return node;
	}
	return { ...node, ...qualifier } as T;
}

function qualifierOf(node: ReferenceExpression): ReferenceQualifier {
	if (!("sheet" in node)) return {};
	return {
		...(node.sheet === undefined ? {} : { sheet: node.sheet }),
		...(node.sheetTo === undefined ? {} : { sheetTo: node.sheetTo }),
		...(node.workbook === undefined ? {} : { workbook: node.workbook }),
		...(node.external === undefined ? {} : { external: node.external }),
	};
}

function binaryChain(
	operand: Grammar<FormulaNode>,
	operator: Grammar<string>,
): Grammar<FormulaNode> {
	return and([
		operand,
		zeroOrMany(and([operator, operand])),
	], ([left, tail]) => {
		let result = left;
		for (const [op, right] of tail) {
			result = {
				type: "binary",
				operator: op as BinaryOperator,
				left: result,
				right,
			};
		}
		return result;
	});
}

function referenceChain(
	operand: Grammar<FormulaNode>,
	operator: Grammar<string>,
	type: "union" | "intersection",
): Grammar<FormulaNode> {
	return and([
		operand,
		zeroOrMany(and([operator, operand])),
	], ([left, tail]) => {
		let result = left;
		for (const [, right] of tail) {
			result = { type, left: result, right };
		}
		return result;
	});
}

const formulaParser = createParser(
	tokens,
	{
		PROGRAM(): Grammar<FormulaNode> {
			return or([
				and([
					consume(LCurly),
					consume(Equal),
					rule(this.UNION),
					consume(RCurly),
				], ([, , expression]): LegacyArrayFormula => ({
					type: "legacy-array-formula",
					expression,
				})),
				and([
					zeroOrOne(consume(Equal)),
					rule(this.UNION),
				], ([, expression]) => expression),
			]);
		},

		UNION(): Grammar<FormulaNode> {
			return referenceChain(
				rule(this.COMPARISON),
				consume(Comma),
				"union",
			);
		},

		COMPARISON(): Grammar<FormulaNode> {
			return binaryChain(
				rule(this.CONCATENATION),
				or([
					consume(LessEqual),
					consume(GreaterEqual),
					consume(NotEqual),
					consume(Equal),
					consume(Less),
					consume(Greater),
				]),
			);
		},

		CONCATENATION(): Grammar<FormulaNode> {
			return binaryChain(rule(this.ADDITIVE), consume(Concat));
		},

		ADDITIVE(): Grammar<FormulaNode> {
			return binaryChain(
				rule(this.MULTIPLICATIVE),
				or([consume(Plus), consume(Minus)]),
			);
		},

		MULTIPLICATIVE(): Grammar<FormulaNode> {
			return binaryChain(
				rule(this.UNARY),
				or([consume(Multiply), consume(Divide)]),
			);
		},

		UNARY(): Grammar<FormulaNode> {
			return or([
				and([
					or([
						consume(Plus),
						consume(Minus),
						consume(ImplicitIntersection),
					]),
					rule(this.UNARY),
				], ([operator, argument]): FormulaNode => ({
					type: "unary",
					operator: operator as UnaryExpression["operator"],
					argument,
				})),
				rule(this.POWER),
			]);
		},

		POWER(): Grammar<FormulaNode> {
			return and([
				rule(this.INTERSECTION),
				zeroOrOne(and([
					consume(Power),
					rule(this.UNARY),
				])),
			], ([left, tail]) => {
				if (!tail) return left;
				return {
					type: "binary",
					operator: "^",
					left,
					right: tail[1],
				};
			});
		},

		INTERSECTION(): Grammar<FormulaNode> {
			return referenceChain(
				rule(this.POSTFIX),
				skipIn(null, consume(Whitespace)),
				"intersection",
			);
		},

		POSTFIX(): Grammar<FormulaNode> {
			return and([
				rule(this.PRIMARY),
				zeroOrMany(or([
					consume(
						Percent,
						() => ({ type: "operator" as const, value: "%" as const }),
					),
					consume(
						Spill,
						() => ({ type: "operator" as const, value: "#" as const }),
					),
					and([
						consume(Dot),
						or([
							consume(Identifier),
							consume(Column),
							consume(
								StructuredReferenceToken,
								(raw) => raw.slice(1, -1),
							),
						]),
					], ([, field]) => ({ type: "field" as const, field })),
					and([
						consume(LParen),
						rule(this.ARGUMENTS),
						consume(RParen),
					], ([, args]) => ({ type: "invoke" as const, args })),
				])),
			], ([argument, suffixes]) => {
				let result = argument;
				for (const suffix of suffixes) {
					if (suffix.type === "operator") {
						result = {
							type: "postfix",
							operator: suffix.value,
							argument: result,
						};
					} else if (suffix.type === "field") {
						result = {
							type: "field",
							object: result,
							field: suffix.field,
						};
					} else {
						result = {
							type: "invoke",
							callee: result,
							arguments: suffix.args,
						};
					}
				}
				return result;
			});
		},

		PRIMARY(): Grammar<FormulaNode> {
			return or([
				rule(this.FUNCTION_CALL),
				rule(this.RANGE),
				rule(this.REFERENCE),
				rule(this.ARRAY),
				and([
					consume(LParen),
					rule(this.UNION),
					consume(RParen),
				], ([, expression]) => expression),
				consume(StringToken, (raw): StringLiteral => ({
					type: "string",
					value: raw.slice(1, -1).replaceAll('""', '"'),
				})),
				consume(BooleanToken, (raw): BooleanLiteral => ({
					type: "boolean",
					value: raw.toUpperCase() === "TRUE",
				})),
				consume(ErrorToken, (raw): ErrorLiteral => ({
					type: "error",
					value: raw.toUpperCase(),
				})),
				consume(NumberToken, (raw): NumberLiteral => ({
					type: "number",
					value: Number(raw),
					raw,
				})),
				rule(this.STRUCTURED_REFERENCE),
				rule(this.NAME),
			]);
		},

		FUNCTION_CALL(): Grammar<FormulaNode> {
			return and([
				zeroOrOne(rule(this.QUALIFIER)),
				or([
					consume(Identifier),
					consume(Column),
					consume(Cell),
					consume(R1C1Cell),
					consume(R1C1Row),
					consume(R1C1Column),
				]),
				consume(LParen),
				rule(this.ARGUMENTS),
				consume(RParen),
			], ([qualifier, name, , args]): CallExpression => ({
				type: "call",
				...(qualifier ?? {}),
				name: name.toUpperCase(),
				arguments: args,
			}));
		},

		ARGUMENTS(): Grammar<(FormulaNode | MissingArgument)[]> {
			return and([
				zeroOrOne(rule(this.COMPARISON)),
				zeroOrMany(and([
					or([consume(Comma), consume(Semicolon)]),
					zeroOrOne(rule(this.COMPARISON)),
				])),
			], ([first, tail]) => {
				if (first === undefined && tail.length === 0) return [];
				return [
					first ?? missingArgument,
					...tail.map(([, argument]) => argument ?? missingArgument),
				];
			});
		},

		ARRAY(): Grammar<FormulaNode> {
			return and([
				consume(LCurly),
				zeroOrManySep(
					zeroOrManySep(rule(this.COMPARISON), consume(Comma)),
					consume(Semicolon),
				),
				consume(RCurly),
			], ([, rows]): ArrayLiteral => ({
				type: "array",
				rows,
			}));
		},

		RANGE(): Grammar<FormulaNode> {
			return or([
				and([
					zeroOrOne(rule(this.QUALIFIER)),
					consume(WholeColumnRange),
				], ([qualifier, raw]): RangeExpression => {
					const [from, to] = raw.split(":");
					return {
						type: "range",
						from: parseColumn(from, qualifier),
						to: parseColumn(to, qualifier),
					};
				}),
				and([
					zeroOrOne(rule(this.QUALIFIER)),
					consume(WholeRowRange),
				], ([qualifier, raw]): RangeExpression => {
					const [from, to] = raw.split(":");
					return {
						type: "range",
						from: parseRow(from, qualifier),
						to: parseRow(to, qualifier),
					};
				}),
				and([
					rule(this.REFERENCE_ENDPOINT),
					consume(Colon),
					rule(this.REFERENCE_ENDPOINT),
				], ([from, , rawTo]): RangeExpression => {
					const to = withInheritedQualifier(rawTo, qualifierOf(from));
					return { type: "range", from, to };
				}),
			]);
		},

		REFERENCE_ENDPOINT(): Grammar<ReferenceExpression> {
			return and([
				zeroOrOne(rule(this.QUALIFIER)),
				or([
					and([
						rule(this.FUNCTION_CALL),
					], ([node]) => ({
						kind: "node" as const,
						node: node as CallExpression,
					})),
					consume(Cell, (raw) => ({ kind: "cell" as const, raw })),
					consume(R1C1Cell, (raw) => ({ kind: "r1c1" as const, raw })),
					consume(R1C1Row, (raw) => ({ kind: "r1c1" as const, raw })),
					consume(R1C1Column, (raw) => ({ kind: "r1c1" as const, raw })),
					consume(Column, (raw) => ({ kind: "column" as const, raw })),
					consume(NumberToken, (raw) => ({ kind: "row" as const, raw })),
					consume(StructuredReferenceToken, (raw) => ({
						kind: "structured" as const,
						raw,
					})),
					consume(ErrorToken, (raw) => ({ kind: "invalid" as const, raw })),
					consume(Identifier, (raw) => ({ kind: "name" as const, raw })),
				]),
			], ([qualifier = {}, endpoint]) => {
				switch (endpoint.kind) {
					case "node":
						return withInheritedQualifier(endpoint.node, qualifier);
					case "cell":
						return parseCell(endpoint.raw, qualifier);
					case "r1c1":
						return parseR1C1(endpoint.raw, qualifier);
					case "column":
						return parseColumn(endpoint.raw, qualifier);
					case "row":
						return parseRow(endpoint.raw, qualifier);
					case "structured":
						return parseStructured(endpoint.raw, qualifier);
					case "invalid":
						return { type: "invalid-reference", ...qualifier };
					case "name":
						return { type: "name", ...qualifier, name: endpoint.raw };
				}
			});
		},

		REFERENCE(): Grammar<FormulaNode> {
			return or([
				and([
					rule(this.QUALIFIER),
					consume(ErrorToken),
				], ([qualifier]): InvalidReference => ({
					type: "invalid-reference",
					...qualifier,
				})),
				and([
					zeroOrOne(rule(this.QUALIFIER)),
					or([
						consume(Cell, (raw) => ({ kind: "cell" as const, raw })),
						consume(R1C1Cell, (raw) => ({
							kind: "r1c1" as const,
							raw,
						})),
						consume(R1C1Row, (raw) => ({
							kind: "r1c1" as const,
							raw,
						})),
						consume(R1C1Column, (raw) => ({
							kind: "r1c1" as const,
							raw,
						})),
					]),
				], ([qualifier = {}, reference]) => {
					return reference.kind === "cell"
						? parseCell(reference.raw, qualifier)
						: parseR1C1(reference.raw, qualifier);
				}),
			]);
		},

		STRUCTURED_REFERENCE(): Grammar<FormulaNode> {
			return and([
				zeroOrOne(rule(this.QUALIFIER)),
				consume(StructuredReferenceToken),
			], ([qualifier = {}, raw]) => parseStructured(raw, qualifier));
		},

		NAME(): Grammar<FormulaNode> {
			return and([
				zeroOrOne(rule(this.QUALIFIER)),
				or([
					consume(Identifier),
					consume(Column),
				]),
			], ([qualifier = {}, name]): NameExpression => ({
				type: "name",
				...qualifier,
				name,
			}));
		},

		QUALIFIER(): Grammar<ReferenceQualifier> {
			return consume(QualifierToken, parseQualifier);
		},
	},
	() => consume(Whitespace),
);

/**
 * Parse an Excel-style spreadsheet formula into a typed AST.
 *
 * The leading "=" is optional, allowing the same parser to handle formulas
 * copied from a cell and expression fragments used by formula editors.
 */
export function parseFormula(input: string): FormulaNode {
	return formulaParser("PROGRAM", input);
}

if (import.meta.main) {
	console.log(
		JSON.stringify(
			parseFormula(
				`=IF(SUM('Q1 Sales'!$B$2:B10)>=1000,"target met",AVERAGE(C:C)*1.2)`,
			),
			null,
			2,
		),
	);
}
