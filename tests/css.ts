import { EOF, createToken, nanolex, getComposedTokens } from "../src/nanolex.ts";

const LineBreak = createToken(/[\n\r]/, "LineBreak");
const Whitespace = createToken(/[ \t]+/, "Whitespace");
const LSquare = createToken("[");
const RSquare = createToken("]");
const LCurly = createToken("{");
const RCurly = createToken("}");
const Exclamation = createToken("!");
const Semicolon = createToken(";");
const Colon = createToken(":");
const Comma = createToken(",");
const Dot = createToken(".");
const Hex = createToken(/#(?:(?:[0-9a-fA-F]{2}){3}|(?:[0-9a-fA-F]){3})/, "Hex");
const Hash = createToken("#");
const Px = createToken("px");
const Em = createToken("em");
const Important = createToken("important");
const NumberLiteral = createToken(
	/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
	"NumberLiteral",
);
const StringLiteral = createToken(/[a-zA-Z_$][a-zA-Z0-9_$-]*/, "StringLiteral");

const tokens = getComposedTokens([
	Whitespace,
	LineBreak,
	LSquare,
	RSquare,
	LCurly,
	RCurly,
	Exclamation,
	Semicolon,
	Colon,
	Comma,
	Dot,
	Hex,
	Hash,
	Important,
	Px,
	Em,
	Important,
	NumberLiteral,
	StringLiteral,
]);

export function parser(value: string) {
	const {
		consume,
		zeroOrOne,
		zeroOrMany,
		zeroOrManySep,
		and,
		or,
		patternToSkip,
		throwIfError,
	} = nanolex(value, tokens);

	patternToSkip(or([
		consume(LineBreak),
		consume(Whitespace),
	]));

	function TEST(fn: Function) {
		return () => {
			console.log(`>> TEST(${fn.name})`);
			const output = fn();
			console.log({ output });
			console.log(`<< TEST(${fn.name})`);

			return output;
		};
	}

	function SELECTOR_CLASS() {
		return and([consume(Dot), consume(StringLiteral)], ([_, name]) => ({
			type: "selector",
			scope: "class",
			name,
		}))();
	}

	function SELECTOR_ID() {
		return and([consume(Hash), consume(StringLiteral)], ([_, name]) => ({
			type: "selector",
			scope: "id",
			name,
		}))();
	}

	function SELECTOR() {
		return or([SELECTOR_CLASS, SELECTOR_ID])();
	}

	function VALUE() {
		return or([
			consume(Hex),
			consume(StringLiteral),
			and(
				[consume(NumberLiteral, Number), or([consume(Px), consume(Em)])],
				([value, unit]) => ({
					type: "size",
					value,
					unit,
				}),
			),
		])();
	}

	function IMPORTANT_FLAG() {
		return zeroOrOne(
			and([consume(Exclamation), consume(Important)], () => true),
		)();
	}

	function DECLARATION() {
		return and(
			[
				consume(StringLiteral),
				consume(Colon),
				VALUE,
				IMPORTANT_FLAG,
				consume(Semicolon),
			],
			([name, _, value, isImportant]) => ({
				type: "rule",
				name,
				value,
				important: !!isImportant,
			}),
		)();
	}

	function DECLARATIONS_GROUP() {
		return and(
			[consume(LCurly), zeroOrMany(DECLARATION), consume(RCurly)],
			([_, declarations]) => declarations,
		)();
	}

	function RULESET() {
		return and(
			[zeroOrManySep(SELECTOR, consume(Comma)), DECLARATIONS_GROUP],
			([selectors, rules]) => ({
				type: "ruleset",
				selectors,
				rules,
			}),
		)();
	}

	function PROGRAM() {
		return zeroOrMany(RULESET)();
	}

	const [output] = throwIfError(and([PROGRAM, consume(EOF)]));

	return output;
}
