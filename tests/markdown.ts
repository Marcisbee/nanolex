// deno-lint-ignore-file
import {
  and,
  consume,
  consumeBehind,
  consumeUntil,
  createParser,
  createToken,
  EOF,
  type Grammar,
  not,
  oneOrMany,
  oneOrManySep,
  or,
  peek,
  rule,
  zeroOrMany,
} from "../src/nanolex.ts";

/* -------------------------------------------------------------------------- */
/* Tokens                                                                     */
/* -------------------------------------------------------------------------- */

const Whitespace = createToken(/[ \t]+/, "Whitespace");
const NewLine = createToken(/[\n\r]/, "NewLine");
const Hash = createToken("#", "Hash");
const Star = createToken("*", "Star");
const Underscore = createToken("_", "Underscore");
const Tilde = createToken("`", "Backtick");
const Lt = createToken("<", "Lt");
const Gt = createToken(">", "Gt");
const Equal = createToken("=", "Equal");

/**
 * Helper tokens only used via consume() (not part of splitting):
 *  - Anything: greedy fallback for inline text segments
 *  - Word: alphanumeric word boundary checks used in emphasis rules
 *
 * They are NOT included in the token splitting array on purpose.
 */
const Anything = createToken(/.*/u, "Anything");
const Word = createToken(/[a-zA-Z0-9]+/, "Word");

/**
 * Order of tokens matters. We exclude Anything / Word so normal text is
 * produced as raw chunks between recognized delimiters.
 */
const tokens = [
  Whitespace,
  NewLine,
  Hash,
  Star,
  Underscore,
  Tilde,
  Lt,
  Gt,
  Equal,
];

/* -------------------------------------------------------------------------- */
/* Parser                                                                     */
/* -------------------------------------------------------------------------- */

const mdParser = createParser(
  tokens,
  {
    PROGRAM() {
      return zeroOrMany(
        and([
          zeroOrMany(consume(NewLine)),
          rule(this.BLOCK),
          zeroOrMany(consume(NewLine)),
        ]),
        (arr) => arr.flat(2),
      );
    },

    BLOCK(): Grammar<any> {
      return or([
        rule(this.BLOCK_QUOTE),
        rule(this.BLOCK_HEADING_WITH_UNDERLINE),
        rule(this.BLOCK_HEADING),
        rule(this.TEXT),
      ]);
    },

    BLOCK_HEADING() {
      return and([
        oneOrMany(consume(Hash)),
        oneOrMany(consume(Whitespace)),
        oneOrMany(rule(this.INLINE_TEXT)),
      ], ([hashes, _ws, content]) => ({
        type: "h",
        size: hashes.length,
        content,
      }));
    },

    BLOCK_HEADING_WITH_UNDERLINE() {
      // Collect inline content until newline + === underline
      const underline = and([
        consume(NewLine),
        consume(Equal),
        consume(Equal),
        consume(Equal),
      ]);

      return and([
        oneOrMany(
          rule(this.INLINE_TEXT),
          undefined,
          underline,
        ),
        underline,
      ], ([content]) => ({
        type: "h",
        size: 1,
        content,
      }));
    },

    BLOCK_QUOTE() {
      // > line (newline > line)*
      return and([
        oneOrManySep(
          and([
            consume(Gt),
            zeroOrMany(consume(Whitespace)),
            zeroOrMany(rule(this.BLOCK)),
          ], ([, , content]) => content),
          consume(NewLine),
        ),
      ], ([content]) => ({
        type: "q",
        content,
      }));
    },

    TEXT() {
      return oneOrMany(
        or([
          rule(this.INLINE_TEXT),
          // Preserve single newlines inside paragraph
          and([consume(NewLine), peek(not(consume(NewLine)))], () => "\n"),
        ]),
        (content) => ({
          type: "p",
          content,
        }),
      );
    },

    INLINE_TEXT() {
      return or([
        rule(this.BOLD),
        rule(this.BOLD2),
        rule(this.ITALIC),
        rule(this.ITALIC2),
        rule(this.INLINE_CODE),
        consume(Anything),
      ]);
    },

    // **bold**
    BOLD() {
      const endSentinel = and([consume(Star), consume(Star)]);
      return and([
        consume(Star),
        consume(Star),
        zeroOrMany(
          and([
            not(peek(endSentinel)),
            or([
              rule(this.ITALIC2),
              rule(this.INLINE_CODE),
              consume(Anything),
            ]),
          ], ([, v]) => v),
        ),
        consume(Star),
        consume(Star),
      ], ([, , content]) => ({
        type: "b",
        content,
      }));
    },

    // __bold__
    BOLD2() {
      const sentinel = and([consume(Underscore), consume(Underscore)]);
      return and([
        not(peek(consumeBehind(Word))),
        consume(Underscore),
        consume(Underscore),
        consumeUntil(sentinel),
        consume(Underscore),
        consume(Underscore),
        not(peek(consume(Word))),
      ], ([, , , content]) => ({
        type: "b",
        content,
      }));
    },

    // *italic*
    ITALIC() {
      return and([
        consume(Star),
        consumeUntil(Star),
        consume(Star),
      ], ([, content]) => ({
        type: "i",
        content,
      }));
    },

    // _italic_
    ITALIC2() {
      return and([
        not(peek(consumeBehind(Word))),
        consume(Underscore),
        consumeUntil(Underscore),
        consume(Underscore),
        not(peek(consume(Word))),
      ], ([, , content]) => ({
        type: "i",
        content,
      }));
    },

    // `code`
    INLINE_CODE() {
      return and([
        consume(Tilde),
        consumeUntil(Tilde),
        consume(Tilde),
      ], ([, content]) => ({
        type: "c",
        content,
      }));
    },

    PROGRAM_EOF() {
      return and([
        rule(this.PROGRAM),
        consume(EOF),
      ], ([program]) => program);
    },
  },
);

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Parse markdown subset into an AST.
 */
export function parser(input: string) {
  return mdParser("PROGRAM_EOF", input);
}

if (import.meta.main) {
  const sample =
    `# Heading\n\nParagraph *italic* and **bold** and \`code\`.\n\n> Quote line 1\n> Quote line 2`;
  console.log(JSON.stringify(parser(sample), null, 2));
}
