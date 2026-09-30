# Declaration grammar exercise

`typescript.ts` expresses declaration, type, member, expression and JSDoc
productions with Nanolex's `and`, `or`, `rule`, `peek`, `not`, repetition,
optional rules and AST transforms. There is no recursive-descent declaration
parser or TypeScript compiler dependency.

A separate lexer uses `SourceCursor` and `sourcePattern` to preserve trivia,
Unicode offsets, line breaks and context-sensitive template token boundaries.
Token text and source metadata are stored in parallel arrays. The `SOURCE` entry
rule adapts those lexemes to Nanolex's `Context`; small terminal predicates read
token categories, line breaks and single-token type boundaries, and a mapped
span transform attaches source metadata. These adapters do not recognize
declarations or recursive types. Expression precedence is composed from grammar
rules and AST folds. Conditional-type contexts use separate recursive rules,
without mutable grammar flags. JSDoc uses combinator grammars for tags, links
and balanced type annotations, followed by field normalization. Like the CSS and
Markdown exercises, it lives under `tests/`; it is not a Nanolex package export
and does not import the TypeScript compiler.

```ts
import { parseDeclarations } from "./typescript.ts";

const file = parseDeclarations(`
/** A named collection. */
export interface Collection<T> {
  readonly values: T[];
  map<U>(fn: (value: T) => U): Collection<U>;
}
`);
const declaration = file.children[0];
console.log(declaration.kind, declaration.name, declaration.docs);
```

The result contains the complete source, ordered declaration children, comments,
and UTF-16 `[start, end)` offsets. Each node has a syntax `kind` and ordered
`children`; names, modifiers, operators, optional markers and rest markers have
separate fields. Types are recursive nodes, including conditional branches,
union/intersection precedence, indexed access, templates, mapped types and
function/constructor signatures. Names and list helper nodes are deliberately
simpler than the compiler AST. The tree does not retain parent pointers.

JSDoc is attached to the following declaration/member/parameter and also
retained in the file's comment list. Documentation includes the original text
and span, description, ordered tags, inline links, parameter names,
optional/default values, and balanced type annotation text. Unknown tags are
preserved. Fenced examples remain prose. JSDoc type annotations retain their
spelling, including Closure syntax; they are not type-checked or resolved.
Triple-slash directives include their names and quoted attributes. Ordinary
comments are preserved too.

Parsing consumes the entire file and fails with an offset and expectation on
unrecognized syntax. It does not silently fall back to opaque balanced blocks.
This is syntax parsing, not a type checker: it does not resolve imports or
triple-slash references, merge declarations, check ambient semantic
restrictions, or execute implementations. Call it for each source file in a
library.

## References

The grammar was developed from these primary references:

- [Archived TypeScript 1.8 specification](https://github.com/microsoft/TypeScript/blob/v4.9.5/doc/spec-ARCHIVED.md),
  especially types, declarations, modules, ambients and the grammar appendix.
- [Declaration reference](https://www.typescriptlang.org/docs/handbook/declaration-files/by-example.html).
- [Conditional types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html),
  [mapped types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html),
  and
  [JSDoc reference](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html).

The archived specification predates modern TypeScript. The current handbook and
compiler AST comparisons cover the newer forms; the old grammar alone is not a
complete declaration-language specification.

## Running the checks

```sh
npm ci
npm run test:typescript
```

The lockfile supplies real published declarations. The corpus recursively reads
all `.d.ts`, `.d.mts` and `.d.cts` files from TypeScript, React, Exome, Vue and
its component packages, plus Node, Babel and csstype. TypeScript 6 is installed
under `typescript-reference` for its compiler API, and TypeScript 7 under
`typescript-current` to exercise its bundled declarations without changing the
package's existing TypeScript build toolchain.

Corpus checks compare complete-file consumption, top-level statement counts and
boundaries, recursive type/declaration kinds and spans, child containment, and
preservation of compiler-recognized JSDoc. Focused tests check the resulting
tree, precedence, modern syntax, documentation fields, source fidelity and
malformed inputs. Package releases are finite regression fixtures, not proof of
perfection for all future TypeScript syntax. Update the pinned corpus and extend
the grammar when a new declaration construct appears.

## Performance checks

Run `npm run bench:typescript` for warmed, parse-only medians over the same
pinned corpus used by the correctness tests. File discovery and reads happen
before timing. The corpus uses 3 warmups and 10 measured runs; DOM, React and
Vue runtime-core use 5 warmups and 20 runs each. Each JSON output row includes
file count, input bytes, repeat counts and median milliseconds. Compare runs on
the same machine and runtime without concurrent CPU-heavy work.

The grammar compiles its declaration and JSDoc combinators with Nanolex. The
compiler generates JavaScript from the grammar; it does not substitute a
handwritten declaration parser. Compilation happens once before warmed timing,
requires dynamic code generation, and leaves the library interpreter as the
default for other consumers.

The grammar uses lookahead dispatch and single token matches for keyword sets
and reuses child AST nodes when a precedence level has no operator. JSDoc avoids
additional parser passes for text without a possible link or leading type
annotation. Nanolex's sequence combinator skips value-array allocation when its
first rule fails; alternatives and optional rules forward untransformed results
without extra result tuples. These optimizations retain the combinator grammar
and its backtracking behavior.
