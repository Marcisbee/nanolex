# Nanolex 🪁

<a href="https://www.npmjs.com/package/nanolex">
  <img alt="npm" src="https://img.shields.io/npm/v/nanolex.svg?style=flat-square" />
</a>
<a href="https://jsr.io/@marcisbee/nanolex">
  <img alt="jsr" src="https://jsr.io/badges/@marcisbee/nanolex?style=flat-square" />
</a>
<a href="https://bundlephobia.com/result?p=nanolex">
  <img alt="package size" src="https://img.shields.io/bundlephobia/minzip/nanolex?style=flat-square" />
</a>

Lightweight TypeScript parser grammar builder for creating custom parsers.

- **Small.** Zero dependencies, minimal overhead.
- **Type-safe.** Strong TypeScript inference through composable primitives.
- **Flexible.** Express complex grammars with focused combinators.
- **Fast.** Regex-based token slicing + minimal object churn.
- **Helpful errors.** Code‑lens style error pointers.

```ts
import {
  createToken,
  createParser,
  consume,
  consumeUntil,
  consumeBehind,
  and,
  or,
  zeroOrManySep,
  oneOrMany,
  zeroOrOne,
  zeroOrMany,
  oneOrManySep,
  peek,
  not,
  skipIn,
  rule,
  EOF,
} from "nanolex";

// 1. Define tokens
const Whitespace = createToken(/[ \t\r\n]+/, "Whitespace");
const LParen = createToken("(");
const RParen = createToken(")");
const Comma = createToken(",");
const Integer = createToken(/-?\d+/, "Integer");
const Identifier = createToken(/[A-Za-z_][A-Za-z0-9_]*/, "Identifier");

// 2. Token list (order matters: earlier = higher splitting priority)
const tokens = [
  Whitespace,
  LParen,
  RParen,
  Comma,
  Integer,
  Identifier,
];

// 3. Build grammar rules (each key returns a Parser factory)
const parser = createParser(
  tokens,
  {
    FUNCTION() {
      return and([
        consume(Identifier),
        consume(LParen),
        rule(this.PARAMS),
        consume(RParen),
      ], ([name, _lp, params]) => ({
        type: "function",
        name,
        params,
      }));
    },
    PARAMS() {
      // VALUE (',' VALUE)*
      return zeroOrManySep(rule(this.VALUE), consume(Comma));
    },
    VALUE() {
      return or([
        consume(Integer, Number),
        rule(this.FUNCTION),
      ]);
    },
    PROGRAM() {
      // Skip whitespace only inside this rule
      return skipIn(
        consume(Whitespace),
        rule(this.FUNCTION),
      );
    },
  },
);

function parse(value: string) {
	return parser("PROGRAM", value);
}

// 4. Execute ()
console.log(parse("SUM(1, SUM(2, 3))"));
/*
{
  type: "function",
  name: "SUM",
  params: [ 1, { type: "function", name: "SUM", params: [ 2, 3 ] } ]
}
*/
```

[live demo](https://dune.land/dune/53ba2f1d-316e-4840-bc19-a65f2c75050c)

## Install

```sh
npm install nanolex
# or
deno add jsr:@marcisbee/nanolex
```

## Core API

### Tokens

`createToken(pattern: string | RegExp, name?: string)`

Defines a token. When you pass a `RegExp`, the engine splits input using a combined alternation of all token sources. For regex tokens, the whole chunk must match (implicit ^...$ optimization via caching).
Order of tokens in the array influences splitting precedence.

`EOF` – Special end-of-file sentinel token.

### Parser Construction

`createParser(tokens, rules, skipFactory?)`

- `tokens`: array returned from multiple `createToken` calls.
- `rules`: object where each key is a function returning a parser (factory style).
- `skipFactory` (optional): `() => Parser` globally applied as a skip rule (whitespace/comments). You can instead use `skipIn(skipRule, innerRule)` locally.

Returns an object: each rule name becomes a function `(ruleName: string, input: string) => any` invoked as `parser("RULE", source)`.

### Rule Helpers

`rule(this.SomeRule)`
Lazy reference to another rule (supports forward / mutual recursion). Always wrap internal references with `rule(...)` inside the rules object for clarity and to avoid premature evaluation.

### Primitive Combinators

- `consume(token, transform?)`
  Consume the next matching token. Optional transform maps the raw string to another value.

- `consumeBehind(token, transform?)`
  Attempt to match a token immediately behind the current position (useful for context-sensitive checks).

- `consumeUntil(tokenOrRule, transform?)`
  Collect raw chunks until (not including) a token or rule matches. If the sentinel is `EOF`, consumes all remaining chunks.

- `and([ruleA, ruleB, ...], transform?)`
  Sequential composition. Fails on the first failing child. `transform` receives an array of values.

- `or([ruleA, ruleB, ...], transform?)`
  First success wins. `transform` receives the chosen value.

- `zeroOrMany(rule, transform?)`
  Repeated rule (Kleene star). Returns array (maybe empty).

- `oneOrMany(rule, transform?)`
  Like above, but requires at least one match.

- `zeroOrManySep(rule, sepRule, transform?)`
  Repeated rule with separator (e.g., list parsing). Trailing separator not consumed unless followed by another element.

- `oneOrManySep(rule, sepRule, transform?)`
  Same as `zeroOrManySep` but enforces at least one element.

- `zeroOrOne(rule, transform?)`
  Optional rule; returns `null` (or transformed) when absent.

- `peek(rule)`
  Lookahead: attempts a rule without consuming tokens.

- `not(rule)`
  Negative lookahead: succeeds (consumes nothing) only if `rule` would fail.

- `skipIn(skipRule, innerRule)`
  Temporarily installs a skip rule (e.g., whitespace/comments) while executing `innerRule`.

### Lazy Rule Access

All cross-rule references inside the rule builder must use `rule(this.RULE_NAME)` to ensure proper late binding. This mirrors declarative grammars while staying type-friendly.

### Error Reporting

On failure, `createParser` throws a descriptive error:
```
Parse error: expected <TOKEN> but found "<got>" at char <position>

  <lineNumber-1>| <previous line>
  <lineNumber>| <line with carets>
            ^^^
```
The caret region highlights the problematic token (or position near EOF).

### Transform Functions

Each combinator’s optional `transform` receives fully resolved child values only if the branch succeeds. Returning domain objects from transforms keeps grammar definitions concise (e.g. building AST nodes directly).

### Skipping Whitespace / Trivia

You can:
1. Provide a global skip rule: `createParser(tokens, rules, () => consume(Whitespace))`
2. Use `skipIn(consume(Whitespace), rule(this.SomeRule))` for finer-grained control.

Skip rules are re-applied between token consumptions and must always consume at least one token when they succeed to avoid infinite loops.

## Use Cases

- Mathematical expressions: `2 + 3 * (4 - 1)`
- Configuration files & mini DSLs
- Query or filter languages
- Template / macro engines
- Lightweight interpreters or transpilers
- Structured command parsers (CLI-style grammars)

## Additional Patterns

```ts
// Capture raw text until a closing parenthesis (without nesting logic)
const RawUntilParen = consumeUntil(RParen, parts => parts.join("").trim());

// Optional sign in a number expression
const SignedInteger = and([
  zeroOrOne(or([consume(createToken("+")), consume(createToken("-"))])),
  consume(Integer, Number),
], ([sign, value]) => sign === "-" ? -value : value);

// List with trailing optional comma: item (',' item)* (',')?
const TrailingList = and([
  oneOrManySep(rule(this.VALUE), consume(Comma)),
  zeroOrOne(consume(Comma)),
], ([values]) => values);
```

## Performance Notes

- Token splitting happens once per input string using a combined alternation regex for all tokens.
- Each token test uses a cached result to avoid repeated regex engine work.
- Combinators are allocation-light; most arrays are user-facing (e.g., list rule outputs).
- Failures unwind immediately—no excessive backtracking in typical grammars.

## License

[MIT](LICENSE) &copy; [Marcis](https://github.com/Marcisbee)
