import {
	and,
	consume,
	createParser,
	createToken,
	type Grammar,
	or,
	rule,
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

export interface CellReference {
	type: "reference";
	sheet?: string;
	column: string;
	row: number;
	columnAbsolute: boolean;
	rowAbsolute: boolean;
}

export interface ColumnReference {
	type: "column-reference";
	sheet?: string;
	column: string;
	absolute: boolean;
}

export interface RowReference {
	type: "row-reference";
	sheet?: string;
	row: number;
	absolute: boolean;
}

export type Reference = CellReference | ColumnReference | RowReference;

export interface RangeExpression {
	type: "range";
	from: Reference;
	to: Reference;
}

export interface NameExpression {
	type: "name";
	name: string;
}

export interface StructuredReference {
	type: "structured-reference";
	table?: string;
	specifier: string;
}

export interface MissingArgument {
	type: "missing";
}

export interface CallExpression {
	type: "call";
	name: string;
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

export type FormulaNode =
	| NumberLiteral
	| StringLiteral
	| BooleanLiteral
	| ErrorLiteral
	| CellReference
	| RangeExpression
	| NameExpression
	| StructuredReference
	| CallExpression
	| UnaryExpression
	| PostfixExpression
	| BinaryExpression
	| ArrayLiteral;

type BinaryOperator = BinaryExpression["operator"];

const Whitespace = createToken(/[ \t\r\n]+/, "Whitespace");
const StringToken = createToken(/"(?:""|[^"])*"/, "String");
const QuotedSheet = createToken(/'(?:''|[^'])*'/, "QuotedSheet");
const StructuredReferenceToken = createToken(
	/(?:[A-Za-z_\\][A-Za-z0-9_.\\]*)?\[(?:[^[\]]|\[[^[\]]*\])*\]/,
	"StructuredReference",
);
const ErrorToken = createToken(
	/#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!|GETTING_DATA)/,
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
const BooleanToken = createToken(
	/(?:[Tt][Rr][Uu][Ee]|[Ff][Aa][Ll][Ss][Ee])(?![A-Za-z0-9_.])/,
	"Boolean",
);
const NumberToken = createToken(
	/(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/,
	"Number",
);
const Identifier = createToken(
	/[A-Za-z_\\][A-Za-z0-9_.\\]*/,
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

const tokens = [
	Whitespace,
	StringToken,
	QuotedSheet,
	StructuredReferenceToken,
	ErrorToken,
	WholeColumnRange,
	WholeRowRange,
	Cell,
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
];

const missingArgument: MissingArgument = { type: "missing" };

function parseSheet(raw: string): string {
	return raw[0] === "'" ? raw.slice(1, -1).replaceAll("''", "'") : raw;
}

function parseCell(raw: string, sheet?: string): CellReference {
	const match = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d*)$/.exec(raw);
	if (!match) {
		throw new Error(`Invalid cell reference: ${raw}`);
	}
	return {
		type: "reference",
		...(sheet === undefined ? {} : { sheet }),
		column: match[2].toUpperCase(),
		row: Number(match[4]),
		columnAbsolute: match[1] === "$",
		rowAbsolute: match[3] === "$",
	};
}

function parseColumn(raw: string, sheet?: string): ColumnReference {
	const trimmed = raw.trim();
	return {
		type: "column-reference",
		...(sheet === undefined ? {} : { sheet }),
		column: trimmed.replace("$", "").toUpperCase(),
		absolute: trimmed[0] === "$",
	};
}

function parseRow(raw: string, sheet?: string): RowReference {
	const trimmed = raw.trim();
	return {
		type: "row-reference",
		...(sheet === undefined ? {} : { sheet }),
		row: Number(trimmed.replace("$", "")),
		absolute: trimmed[0] === "$",
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

const formulaParser = createParser(
	tokens,
	{
		PROGRAM(): Grammar<FormulaNode> {
			return and([
				zeroOrOne(consume(Equal)),
				rule(this.COMPARISON),
			], ([, expression]) => expression);
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
				rule(this.POSTFIX),
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

		POSTFIX(): Grammar<FormulaNode> {
			return and([
				rule(this.PRIMARY),
				zeroOrMany(or([consume(Percent), consume(Spill)])),
			], ([argument, operators]) => {
				let result = argument;
				for (const operator of operators) {
					result = {
						type: "postfix",
						operator: operator as PostfixExpression["operator"],
						argument: result,
					};
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
					rule(this.COMPARISON),
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
				consume(
					StructuredReferenceToken,
					(raw): StructuredReference => {
						const bracket = raw.indexOf("[");
						return {
							type: "structured-reference",
							...(bracket === 0 ? {} : { table: raw.slice(0, bracket) }),
							specifier: raw.slice(bracket),
						};
					},
				),
				or([
					consume(Identifier),
					consume(Column),
				], (name): NameExpression => ({
					type: "name",
					name,
				})),
			]);
		},

		FUNCTION_CALL(): Grammar<FormulaNode> {
			return and([
				or([
					consume(Identifier),
					consume(Column),
					consume(Cell),
				]),
				consume(LParen),
				rule(this.ARGUMENTS),
				consume(RParen),
			], ([name, , args]): CallExpression => ({
				type: "call",
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
					zeroOrOne(rule(this.SHEET)),
					consume(Cell),
					consume(Colon),
					zeroOrOne(rule(this.SHEET)),
					consume(Cell),
				], ([sheet, from, , toSheet, to]): RangeExpression => ({
					type: "range",
					from: parseCell(from, sheet),
					to: parseCell(to, toSheet ?? sheet),
				})),
				and([
					zeroOrOne(rule(this.SHEET)),
					consume(WholeColumnRange),
				], ([sheet, raw]): RangeExpression => {
					const [from, to] = raw.split(":");
					return {
						type: "range",
						from: parseColumn(from, sheet),
						to: parseColumn(to, sheet),
					};
				}),
				and([
					zeroOrOne(rule(this.SHEET)),
					consume(WholeRowRange),
				], ([sheet, raw]): RangeExpression => {
					const [from, to] = raw.split(":");
					return {
						type: "range",
						from: parseRow(from, sheet),
						to: parseRow(to, sheet),
					};
				}),
			]);
		},

		REFERENCE(): Grammar<FormulaNode> {
			return and([
				zeroOrOne(rule(this.SHEET)),
				consume(Cell),
			], ([sheet, cell]) => parseCell(cell, sheet));
		},

		SHEET(): Grammar<string> {
			return and([
				or([
					consume(QuotedSheet),
					consume(Identifier),
					consume(Column),
					consume(Cell),
				]),
				consume(Bang),
			], ([sheet]) => parseSheet(sheet));
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
