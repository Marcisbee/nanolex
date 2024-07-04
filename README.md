# nanolex

@TODO readme

Very experimental parser building library

## Usage

```sh
npm i nanolex
```

```ts
import { EOF, createToken, nanolex, getComposedTokens } from "nanolex";

// Define tokens
const Whitespace = createToken(/[ \t\n\r]+/, "WhiteSpace");
const LParen = createToken("(");
const RParen = createToken(")");
const Comma = createToken(",");
const Integer = createToken(/-?\d+/, "Integer");
const Identifier = createToken(/\w+/, "Identifier");

// List of tokenizable tokens
const tokens = getComposedTokens([
  Whitespace,
  LParen,
  RParen,
  Comma,
  Integer,
]);

// Define the usage of your parser
export function parser(value: string) {
  // Initiate grammar
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

  // Write patterns to skip, in this case ignore whitespace
  // Pattern is just grammar
  patternToSkip(consume(Whitespace));

  // Write parser grammar patterns here

  function FUNCTION() {
    return and([
      consume(Identifier),
      consume(LParen),
      PARAMS,
      consume(RParen),
    ], transform)();

    function transform([name, _, params]) {
      return {
        type: "function",
        name,
        params,
      };
    }
  }

  function PARAMS() {
    return zeroOrManySep(
      VALUE,
      consume(Comma),
    )();
  }

  function VALUE() {
    return or([
      consume(Integer, Number),
      FUNCTION,
    ])();
  }

  // Run the grammar
  const [output] = throwIfError(and([FUNCTION, consume(EOF)]));

  return output;
}
```

```ts
import { parser } from "./parser.ts";

parser("SUM(1, SUM(2, 3))");
/*
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
