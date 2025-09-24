# Nanolex 🪁

Nanolex is a lightweight, TypeScript-first parser grammar builder designed for creating custom parsers with minimal overhead. It provides a flexible API to define tokens and grammar patterns, enabling developers to parse structured text into meaningful data structures efficiently. Ideal for parsing expressions, configuration files, or domain-specific languages.

## Features

- **Token Definition**: Create tokens using strings or regular expressions for precise lexical analysis.
- **Grammar Combinators**: Build complex grammars with combinators like `and`, `or`, `zeroOrMany`, `oneOrMany`, and more.
- **Transformations**: Transform parsed results into custom data structures using optional transform functions.
- **Error Handling**: Detailed error reporting with `throwIfError` for robust debugging.
- **Skip Patterns**: Ignore irrelevant tokens (e.g., whitespace) during parsing.
- **Type-Safe**: Fully typed for seamless integration with TypeScript projects.
- **Lightweight**: Minimal dependencies and optimized for performance.

## Installation

Install Nanolex via npm:

```bash
npm install nanolex
```

## Usage

Here's an example of parsing a simple function call syntax like `SUM(1, SUM(2, 3))`:

```typescript
import { createPattern, createToken, EOF, getComposedTokens, nanolex } from "nanolex";

// Define tokens
const Whitespace = createToken(/[ \t\n\r]+/, "Whitespace");
const LParen = createToken("(");
const RParen = createToken(")");
const Comma = createToken(",");
const Integer = createToken(/-?\d+/, "Integer");
const Identifier = createToken(/\w+/, "Identifier");

// Combine tokens
const tokens = getComposedTokens([Whitespace, LParen, RParen, Comma, Integer, Identifier]);

// Create patterns
const $function = createPattern("function");
const $params = createPattern("params");
const $value = createPattern("value");

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
  $function.set = and([
    consume(Identifier),
    consume(LParen),
    $params,
    consume(RParen),
  ], ([name, _lparen, params, _rparen]) => ({
    type: "function",
    name,
    params,
  }));

  $params.set = zeroOrManySep($value, consume(Comma));

  $value.set = or([
    consume(Integer, Number),
    $function,
  ]);

  // Run parser
  const [output] = throwIfError(and([$function, consume(EOF)]));
  return output;
}

// Example usage
const result = parser("SUM(1, SUM(2, 3))");
console.log(JSON.stringify(result, null, 2));
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

## API Reference

### Core Functions

- **`createToken(pattern: string | RegExp, name?: string)`**: Defines a token for lexical analysis. Use a string for exact matches or a RegExp for patterns. The `name` parameter is optional and defaults to the pattern's source.
- **`createPattern(name: string)`**: Creates a reusable grammar pattern that can be referenced by name and defined later using the `.set` property.
- **`getComposedTokens(tokens: TokenLike[])`**: Combines tokens into a single regex for efficient parsing.
- **`nanolex(input: string, tokens: ComposedTokens)`**: Initializes the parser with an input string and token set, returning parser utilities.
- **`consume(token: TokenLike, transform?: (value: string) => any)`**: Consumes a token, optionally transforming its value.
- **`consumeBehind(token: TokenLike, transform?: (value: string) => any)`**: Consumes a token in reverse, useful for lookbehind patterns.
- **`consumeUntil(token: TokenLike, transform?: (value: string[]) => any)`**: Consumes tokens until a specified token is encountered.
- **`peek(rule: GrammarLike)`**: Tests a rule without advancing the parser's position.
- **`and(rules: GrammarLike[], transform?: (value: any[]) => any)`**: Matches a sequence of rules in order.
- **`or(rules: GrammarLike[], transform?: (value: any) => any)`**: Matches any one of the provided rules.
- **`zeroOrMany(rule: GrammarLike, transform?: (value: any) => any, until?: GrammarLike)`**: Matches zero or more occurrences of a rule.
- **`oneOrMany(rule: GrammarLike, transform?: (value: any) => any, until?: GrammarLike)`**: Matches one or more occurrences of a rule.
- **`zeroOrManySep(rule: GrammarLike, sep: GrammarLike, transform?: (value: any) => any, until?: GrammarLike)`**: Matches zero or more occurrences of a rule separated by a separator.
- **`oneOrManySep(rule: GrammarLike, sep: GrammarLike, transform?: (value: any) => any, until?: GrammarLike)`**: Matches one or more occurrences of a rule separated by a separator.
- **`zeroOrOne(rule: GrammarLike, transform?: (value: any) => any)`**: Matches zero or one occurrence of a rule.
- **`not(rule: GrammarLike)`**: Succeeds if the rule fails, without consuming input.
- **`patternToSkip(rule: GrammarLike)`**: Marks a rule to be skipped during parsing (e.g., whitespace).
- **`throwIfError(rule: GrammarLike)`**: Executes a rule and throws a detailed error if parsing fails.
- **`breakLoop(type: number, fn: Function)`**: Prevents infinite loops in recursive grammars by tracking rule execution.

### Example Use Cases

- **Mathematical Expressions**: Parse expressions like `2 + 3 * 4`.
- **Configuration Files**: Parse custom formats like INI or YAML-like structures.
- **Domain-Specific Languages**: Create parsers for custom DSLs.
- **Data Validation**: Validate and transform structured input.

## Contributing

Contributions are welcome! To contribute:

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/your-feature`).
3. Commit your changes (`git commit -m "Add your feature"`).
4. Push to the branch (`git push origin feature/your-feature`).
5. Open a Pull Request.

Please include tests and follow the project's coding standards.

## License

Nanolex is licensed under the [MIT License](LICENSE).

## Acknowledgements

Created by [Marcis](https://github.com/Marcisbee). Inspired by the need for a lightweight, TypeScript-friendly parsing library.
