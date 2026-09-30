import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const name = join(path, entry.name);
    return entry.isDirectory()
      ? files(name)
      : /\.d\.[cm]?ts$/.test(name)
      ? [name]
      : [];
  });
}
export const declarationRoots = [
  "typescript",
  "typescript-reference",
  "typescript-current",
  "@types/react",
  "@types/node",
  "@babel",
  "exome",
  "vue",
  "@vue",
  "csstype",
];

export function declarationFiles(root: string): string[] {
  return files(
    fileURLToPath(new URL(`../node_modules/${root}`, import.meta.url)),
  );
}
