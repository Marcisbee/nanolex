import { strict as assert } from "node:assert";
import { type Node, parseDeclarations, parseJSDoc } from "./typescript.ts";

function all(node: Node, kind: string): Node[] {
  return [
    ...(node.kind === kind ? [node] : []),
    ...node.children.flatMap((n) => all(n, kind)),
  ];
}
const type = (source: string) =>
  parseDeclarations(`type Result = ${source};`).children[0].children.at(-1)!;

Deno.test("declaration types preserve precedence and conditional branches", () => {
  const tree = type("A | B & C extends D ? E[] : F[G]");
  assert.equal(tree.kind, "ConditionalType");
  assert.deepEqual(tree.children.map((n) => n.kind), [
    "UnionType",
    "TypeReference",
    "ArrayType",
    "IndexedAccessType",
  ]);
  assert.equal(tree.children[0].children[1].kind, "IntersectionType");
  assert.equal(type("(A | B)[]").children[0].kind, "ParenthesizedType");
  assert.equal(type("() => A | B").children.at(-1)!.kind, "UnionType");
});

Deno.test("modern mapped, inferred, tuple, template and constructor types", () => {
  const mapped = type(
    "{ -readonly [K in keyof T as `get${Capitalize<K & string>}`]+?: T[K] }",
  );
  assert.equal(mapped.kind, "MappedType");
  assert.deepEqual(mapped.modifiers, ["-readonly", "+?"]);
  assert.equal(all(mapped, "NameRemapping").length, 1);
  assert.equal(all(mapped, "TemplateLiteralType").length, 1);
  const inferred = type(
    "T extends [infer U extends string, ...infer R] ? U : never",
  );
  assert.equal(all(inferred, "InferType")[0].children[1].name, "string");
  assert.equal(type("T extends infer U ? U : never").kind, "ConditionalType");
  assert.equal(
    all(type("T extends infer U extends string ? U : never"), "InferType")[0]
      .children.length,
    2,
  );
  assert.equal(
    type("infer U extends string ? U : never").kind,
    "ConditionalType",
  );
  const tuple = type("readonly [name?: string, ...rest: number[]]");
  assert.equal(all(tuple, "TupleElement")[0].optional, true);
  assert.equal(all(tuple, "TupleElement")[1].rest, true);
  assert.equal(type("abstract new <T>(value: T) => T").kind, "ConstructorType");
  assert.equal(
    type('`x${`y${string}`}z${{ a: number }["a"]}`').children.length,
    5,
  );
});

Deno.test("ambient declarations, overloads, computed names and import forms", () => {
  const source = `
/// <reference lib="esnext" />
import type { A as B, type C } from "pkg";
import D, * as NS from "pkg" with { "resolution-mode": "import" };
import Alias = NS.Value;
import Common = require("common");
export type * as Types from "pkg";
export { B, type C as Renamed };
export as namespace Library;
declare module "pkg" {
  export interface Shape<out T> extends Base<T> {
    readonly [key: string]: T;
    new <U>(arg: U): Shape<U>;
    <U>(arg: U): T;
    method(this: Shape<T>, ...args: T[]): asserts args is T[];
  }
}
declare namespace Library.Nested {
  function f(x: string): number;
  function f(x: number): string;
  class Box<T> extends Base<T> implements Other {
    #private;
    protected constructor(value: T);
    static readonly version = "1";
    get value(): T;
    set value(v: T);
    [Symbol.iterator](): Iterator<T>;
  }
  const enum Flags { A = 1 << 2, B = A | 8, C = -1, }
}
declare global { interface Window { box?: Library.Nested.Box<string> } }
export default Library;
`;
  const tree = parseDeclarations(source);
  assert.equal(tree.comments[0].kind, "directive");
  assert.equal(all(tree, "FunctionDeclaration").length, 2);
  assert.equal(all(tree, "MethodSignature").length, 2);
  assert.equal(all(tree, "GetAccessor").length, 1);
  assert.equal(all(tree, "IndexSignature").length, 1);
  assert.equal(all(tree, "ImportEqualsDeclaration").length, 2);
  assert.deepEqual(all(tree, "BinaryExpression").map((n) => n.operator), [
    "<<",
    "|",
  ]);
});

Deno.test("source positions, Unicode identifiers, escapes and documentation survive", () => {
  const source =
    '\ufeff/** Library. */\r\ndeclare namespace Ω {\r\n/** Value.\n * @deprecated Use newValue.\n */\nconst café: "a\\"b";\n} // trailing';
  const tree = parseDeclarations(source);
  assert.equal(tree.source, source);
  assert.equal(tree.children[0].docs?.[0].description, "Library.");
  const variable = all(tree, "VariableStatement")[0];
  assert.equal(variable.docs?.[0].tags[0].name, "deprecated");
  assert.equal(
    source.slice(variable.start, variable.end),
    'const café: "a\\"b";',
  );
  assert.equal(tree.comments.at(-1)!.raw, "// trailing");
  assert.equal(
    parseDeclarations("declare const \\u0061: 1_000n;").children.length,
    1,
  );
});

Deno.test("JSDoc retains descriptions, multiline/unknown tags, types and examples", () => {
  const raw = `/** Does a thing with {@link Thing}.
 * @param {{ nested: { value: string } }} [options={}] - Settings.
 *   More detail.
 * @returns {Promise<string>} Result.
 * @custom-tag keep this
 * @example
 * \`\`\`ts
 * @decorator
 * class Example {}
 * \`\`\`
 */`;
  const doc = parseJSDoc(raw, 10);
  assert.equal(doc.raw, raw);
  assert.equal(doc.end, 10 + raw.length);
  assert.equal(doc.description, "Does a thing with {@link Thing}.");
  assert.deepEqual(doc.tags.map((t) => t.name), [
    "param",
    "returns",
    "custom-tag",
    "example",
  ]);
  assert.equal(doc.tags[0].type, "{ nested: { value: string } }");
  assert.equal(doc.tags[0].parameter, "options");
  assert.equal(doc.tags[0].optional, true);
  assert.equal(doc.tags[0].default, "{}");
  assert.match(doc.tags[0].text, /More detail/);
  assert.match(doc.tags[3].text, /@decorator/);
});

Deno.test("invalid declarations fail instead of becoming opaque balanced text", () => {
  for (
    const source of [
      "type X = ;",
      "type X = A | ;",
      "type X = A & ;",
      "type X = T extends U ? X;",
      "type X = { [K in ]: T };",
      "type X = Foo<Bar;",
      "type X = [a: ];",
      "type X = [, string];",
      "declare function f(, x: string): void;",
      "declare function f(x: ): void;",
      "interface X { a: string b: number }",
      "interface X {",
      "interface X extends {}",
      "type X = `abc${string;",
      "type X = 'unterminated;",
      "/** unterminated",
      "declare const x: string; garbage",
      "const x = @;",
      "function f() { return 1; }",
      "type X = number + string;",
    ]
  ) assert.throws(() => parseDeclarations(source), /Parse error/, source);
  assert.equal(parseDeclarations("type Valid = string;").children.length, 1);
});

Deno.test("parses semicolon-free members, import types and destructured parameters", () => {
  const tree = parseDeclarations(`
interface X {
  readonly: string
  get(): number
  new: boolean
  f({ a, b: [c] }: { a: string; b: [number] }): this is Y
}
type Y = typeof import("pkg", { with: { "resolution-mode": "import" } }).X<string>
type Z = import("pkg").Thing<import("other").Other>
`);
  assert.equal(all(tree, "PropertySignature").length, 4);
  assert.equal(all(tree, "ImportType").length, 3);
  assert.equal(all(tree, "ObjectBinding").length, 1);
});

Deno.test("JSDoc same-line tags, links, directives and member attachments", () => {
  const doc = parseJSDoc(
    "/** See {@link Thing | label}. @param {string} value - Text. @returns {void} Done. */",
  );
  assert.equal(doc.tags.length, 2);
  assert.deepEqual(doc.links, [{
    kind: "link",
    target: "Thing",
    label: "label",
    raw: "{@link Thing | label}",
  }]);
  assert.equal(doc.tags[0].description, "Text.");
  const tree = parseDeclarations(
    `/// <reference types="node" resolution-mode="require" />
interface A {
/** Field. */ x: string;
/** Method. @returns {number} Count. */ f(): number;
}
`,
  );
  assert.deepEqual(tree.comments[0].directive, {
    name: "reference",
    attributes: { types: "node", "resolution-mode": "require" },
  });
  assert.equal(
    all(tree, "PropertySignature")[0].docs?.[0].description,
    "Field.",
  );
  assert.equal(
    all(tree, "MethodSignature")[0].docs?.[0].tags[0].type,
    "number",
  );
});

Deno.test("anonymous generic default classes and contextual member names", () => {
  const tree = parseDeclarations(
    "export default class<T> { new(): T; constructor(value: T); }",
  );
  assert.equal(tree.children[0].name, undefined);
  assert.equal(all(tree, "MethodSignature")[0].name, "new");
  assert.equal(all(tree, "Constructor").length, 1);
  assert.equal(all(tree, "ConstructSignature").length, 0);
});

Deno.test("heritage supports mixin calls and parenthesized constructors", () => {
  const tree = parseDeclarations(
    "declare class Mixed<T> extends mixin(Base)<T> {} declare class Wrapped extends (Base) {}",
  );
  assert.equal(all(tree, "ClassDeclaration").length, 2);
  assert.equal(all(tree, "CallExpression").length, 1);
  assert.equal(all(tree, "HeritageClause").length, 2);
});

Deno.test("ambient backtick initializers preserve literal text and spans", () => {
  const source = "declare const version = `1.0`;";
  const value = parseDeclarations(source).children[0].children[0].children[1];
  assert.equal(value.kind, "TemplateExpression");
  assert.equal(value.children[0].name, "`1.0`");
  assert.equal(source.slice(value.start, value.end), "`1.0`");
});
