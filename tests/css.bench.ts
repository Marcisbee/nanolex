import { parser } from "./css.ts";

const stylesheet = Array.from(
  { length: 250 },
  (_, index) => `
    .card-${index}:not(:is(.disabled, [hidden])) {
      --accent: hsl(${index % 360}deg 80% 50%);
      color: var(--accent, #336699);
      background: linear-gradient(45deg, rgb(0 0 0 / 50%), transparent);
      width: calc(100% - ${index % 20}rem);
      & > .title { margin: 1rem 2ch; }
    }
  `,
).join("\n");

// Parse once so the benchmark measures the hot path with Nanolex's token cache.
parser(stylesheet);

Deno.bench("CSS parser (250 complex rules, warm)", () => {
  parser(stylesheet);
});
