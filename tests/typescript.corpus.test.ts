import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import ts from "typescript-reference";
import { declarationFiles, declarationRoots } from "./typescript.fixtures.ts";
import { type Node, parseDeclarations } from "./typescript.ts";

for (const root of declarationRoots) {
  Deno.test(`declaration corpus: ${root}`, () => {
    const paths = declarationFiles(root);
    assert(paths.length > 0, `Missing corpus ${root}; run npm ci`);
    const failures: string[] = [];
    let count = 0;
    for (const path of paths) {
      const source = readFileSync(path, "utf8");
      const reference = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const diagnostics =
        (reference as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] })
          .parseDiagnostics;
      assert.equal(diagnostics.length, 0, `Invalid reference fixture ${path}`);
      try {
        const tree = parseDeclarations(source);
        assert.equal(tree.end, source.length);
        const declarations = tree.children.filter((n) =>
          n.kind !== "EmptyDeclaration"
        );
        const statements = reference.statements.filter((n) =>
          !ts.isEmptyStatement(n)
        );
        assert.equal(
          declarations.length,
          statements.length,
          `Top-level declarations: ${path}`,
        );
        declarations.forEach((node, i) => {
          assert.equal(
            node.start,
            statements[i].getStart(reference),
            `Start: ${path}`,
          );
          assert.equal(node.end, statements[i].end, `End: ${path}`);
        });
        const validate = (node: Node) => {
          assert(
            node.start >= 0 && node.end <= source.length &&
              node.end >= node.start,
          );
          for (const child of node.children) {
            assert(
              child.start >= node.start && child.end <= node.end,
              `Child span in ${node.kind}`,
            );
            validate(child);
          }
        };
        validate(tree);
        // Compare shared recursive type/declaration productions with the independent
        // compiler AST. Names and helper/list nodes intentionally differ.
        const kinds = new Set([
          "TypeAliasDeclaration",
          "InterfaceDeclaration",
          "ClassDeclaration",
          "FunctionDeclaration",
          "EnumDeclaration",
          "EnumMember",
          "VariableDeclaration",
          "TypeReference",
          "UnionType",
          "IntersectionType",
          "ConditionalType",
          "MappedType",
          "IndexedAccessType",
          "ArrayType",
          "TupleType",
          "FunctionType",
          "ConstructorType",
          "TypeQuery",
          "TypeOperator",
          "InferType",
          "TypePredicate",
          "ParenthesizedType",
          "TypeLiteral",
          "ImportType",
          "ExpressionWithTypeArguments",
        ]);
        const actual: string[] = [], expected: string[] = [];
        const docs = new Set(
          tree.comments.filter((c) => c.doc).map((c) => `${c.start}:${c.end}`),
        );
        for (const comment of tree.comments) {
          assert.equal(comment.raw, source.slice(comment.start, comment.end));
        }
        const visitActual = (node: Node) => {
          if (kinds.has(node.kind)) {
            actual.push(`${node.kind}:${node.start}:${node.end}`);
          }
          node.children.forEach(visitActual);
        };
        const visitExpected = (node: ts.Node) => {
          for (
            const doc of (node as ts.Node & { jsDoc?: ts.JSDoc[] }).jsDoc ?? []
          ) {
            assert(
              docs.has(`${doc.pos}:${doc.end}`),
              `Missing JSDoc at ${doc.pos}: ${path}`,
            );
          }
          const kind = node.kind === ts.SyntaxKind.TypePredicate
            ? "TypePredicate"
            : node.kind === ts.SyntaxKind.ImportType
            ? "ImportType"
            : ts.SyntaxKind[node.kind];
          if (kinds.has(kind)) {
            expected.push(`${kind}:${node.getStart(reference)}:${node.end}`);
          }
          ts.forEachChild(node, visitExpected);
        };
        visitActual(tree);
        visitExpected(reference);
        const actualSet = new Set(actual), expectedSet = new Set(expected);
        assert.deepEqual(
          actual.sort(),
          expected.sort(),
          `Recursive AST: ${path}\nUnexpected: ${
            actual.filter((n) => !expectedSet.has(n)).slice(0, 8).join(", ")
          }\nMissing: ${
            expected.filter((n) => !actualSet.has(n)).slice(0, 8).join(", ")
          }`,
        );
        count++;
      } catch (error) {
        const match = / at (\d+)/.exec(String(error));
        const pos = match ? Number(match[1]) : 0;
        failures.push(
          `${path}: ${error}\n${
            source.slice(Math.max(0, pos - 90), pos + 150)
          }`,
        );
      }
    }
    assert.equal(failures.length, 0, failures.join("\n\n"));
    console.log(`${root}: ${count} complete declaration files`);
  });
}
