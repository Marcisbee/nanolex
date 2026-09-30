/** Warmed parse-only medians; file reads happen before timing begins.
 * Run: npm run bench:typescript
 */
import { readFileSync } from "node:fs";
import { parseDeclarations } from "./typescript.ts";
import { declarationFiles, declarationRoots } from "./typescript.fixtures.ts";
const inputs = declarationRoots.flatMap(declarationFiles).map((path) => ({
  path,
  source: readFileSync(path, "utf8"),
}));
function measure(
  label: string,
  sources: string[],
  warmups: number,
  repeats: number,
) {
  const parse = () => {
    for (const source of sources) parseDeclarations(source);
  };
  for (let i = 0; i < warmups; i++) parse();
  const times = [];
  for (let i = 0; i < repeats; i++) {
    const start = performance.now();
    parse();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const ms =
    (times[Math.floor((repeats - 1) / 2)] + times[Math.floor(repeats / 2)]) / 2;
  console.log(
    JSON.stringify({
      label,
      files: sources.length,
      bytes: sources.reduce(
        (n, s) => n + new TextEncoder().encode(s).length,
        0,
      ),
      warmups,
      repeats,
      median_ms: ms,
    }),
  );
}
measure("corpus", inputs.map((v) => v.source), 3, 10);
for (
  const path of [
    "typescript-reference/lib/lib.dom.d.ts",
    "@types/react/index.d.ts",
    "@vue/runtime-core/dist/runtime-core.d.ts",
  ]
) {
  const input = inputs.find((input) =>
    input.path.replaceAll("\\", "/").endsWith(`/node_modules/${path}`)
  );
  if (!input) throw new Error(`Missing benchmark fixture: ${path}; run npm ci`);
  measure(path, [input.source], 5, 20);
}
