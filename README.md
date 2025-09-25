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
- **Type-safe.** Full TypeScript support with proper inference.
- **Flexible.** Build complex grammars with simple combinators.
- **Fast.** Optimized for performance with detailed error reporting.

```ts
import {
  createPattern,
  createToken,
  EOF,
  getComposedTokens,
  nanolex,
} from "nanolex";

// Define tokens
const Whitespace = createToken(/[ \t\n\r]+/, "Whitespace");
const LParen = createToken("(");
const RParen = createToken(")");
const Comma = createToken(",");
const Integer = createToken(/-?\d+/, "Integer");
const Identifier = createToken(/\w+/, "Identifier");

// Combine tokens
const tokens = getComposedTokens([
  Whitespace,
  LParen,
  RParen,
  Comma,
  Integer,
  Identifier,
]);

// Create patterns
const FUNCTION = createPattern("function");
const PARAMS = createPattern("params");
const VALUE = createPattern("value");

// Define the parser
export function parser(input: string) {
  const {
    consume,
    zeroOrManySep,
    and,
    or,
    patternToSkip,
    throwIfError,
  } = nanolex(input, tokens);

  // Skip whitespace
  patternToSkip(consume(Whitespace));

  // Grammar rules
  FUNCTION.set = and([
    consume(Identifier),
    consume(LParen),
    PARAMS,
    consume(RParen),
  ], ([name, _lparen, params, _rparen]) => ({
    type: "function",
    name,
    params,
  }));

  PARAMS.set = zeroOrManySep(VALUE, consume(Comma));

  VALUE.set = or([
    consume(Integer, Number),
    FUNCTION,
  ]);

  // Run parser
  const [output] = throwIfError(and([FUNCTION, consume(EOF)]));
  return output;
}

// Example usage
const result = parser("SUM(1, SUM(2, 3))");
/* Output:
{
  "type": "function",
  "name": "SUM",
  "params": [
    1,
    {
      "type": "function",
      "name": "SUM",
      "params": [2, 3]
    }
  ]
}
*/
```
[live demo](https://dune.land/dune/53ba2f1d-316e-4840-bc19-a65f2c75050c)

## Install

```sh
npm install nanolex
```

## Core API

### `createToken(pattern, name?)`

Define tokens for lexical analysis using strings or regex.

### `createPattern(name)`

Create reusable grammar patterns that can reference each other.

### `nanolex(input, tokens)`

Initialize parser with input string and token set.

### Grammar Combinators

- `consume(token, transform?)` - Match and consume a token
- `and(rules, transform?)` - Match sequence of rules
- `or(rules, transform?)` - Match any one of the rules
- `zeroOrMany(rule, transform?)` - Match zero or more occurrences
- `oneOrMany(rule, transform?)` - Match one or more occurrences
- `zeroOrManySep(rule, sep, transform?)` - Match with separator
- `zeroOrOne(rule, transform?)` - Optional match
- `patternToSkip(rule)` - Skip tokens (e.g., whitespace)
- `throwIfError(rule)` - Execute rule and throw detailed errors

## Use Cases

- Mathematical expressions: `2 + 3 * (4 - 1)`
- Configuration parsers: Custom DSL formats
- Template engines: Variable interpolation syntax
- Query languages: Custom search expressions

# License

[MIT](LICENSE) &copy; [Marcis](https://github.com/Marcisbee)
