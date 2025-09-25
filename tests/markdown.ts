// deno-lint-ignore-file ban-unused-ignore no-explicit-any no-unused-vars ban-types
import {
  createPattern,
  createToken,
  EOF,
  getComposedTokens,
  nanolex,
} from "../src/nanolex.ts";

const Whitespace = createToken(/[ \t]+/);
const NewLine = createToken(/[\n\r]/);
const Anything = createToken(/.*/);
const Hash = createToken("#");
const Star = createToken("*");
const Underscore = createToken("_");
const Tilde = createToken("`");
const Lt = createToken("<");
const Gt = createToken(">");
const Equal = createToken("=");
const Word = createToken(/[a-zA-Z0-9]+/);

const tokens = getComposedTokens([
  Whitespace,
  NewLine,
  Hash,
  Star,
  Underscore,
  Tilde,
  Lt,
  Gt,
  Equal,
]);

const PROGRAM = createPattern<any[]>("program");
const BLOCK = createPattern<any>("block");
const BLOCK_HEADING = createPattern<any>("blockHeading");
const BLOCK_HEADING_WITH_UNDERLINE = createPattern<any>(
  "blockHeadingWithUnderline",
);
const BLOCK_QUOTE = createPattern<any>("blockQuote");
const TEXT = createPattern<any>("text");
const INLINE_TEXT = createPattern<any>("inlineText");
const BOLD = createPattern<any>("bold");
const BOLD2 = createPattern<any>("bold2");
const ITALIC = createPattern<any>("italic");
const ITALIC2 = createPattern<any>("italic2");
const INLINE_CODE = createPattern<any>("inlineCode");

export function parser(value: string) {
  const {
    consume,
    consumeUntil,
    consumeBehind,
    oneOrMany,
    oneOrManySep,
    zeroOrMany,
    and,
    or,
    peek,
    not,
    throwIfError,
    patternToSkip,
  } = nanolex(value, tokens);

  PROGRAM.set = zeroOrMany(
    and([zeroOrMany(consume(NewLine)), BLOCK, zeroOrMany(consume(NewLine))]),
    (a) => a.flat(2),
  );

  BLOCK.set = or([
    BLOCK_QUOTE,
    BLOCK_HEADING,
    BLOCK_HEADING_WITH_UNDERLINE,
    TEXT,
  ]);

  BLOCK_HEADING.set = and(
    [
      oneOrMany(consume(Hash)),
      oneOrMany(consume(Whitespace)),
      oneOrMany(INLINE_TEXT),
    ],
    ([hash, _, content]) => ({
      type: "h",
      size: hash.length,
      content,
    }),
  );

  BLOCK_HEADING_WITH_UNDERLINE.set = and(
    [
      oneOrMany(
        INLINE_TEXT,
        undefined,
        and([
          consume(NewLine),
          consume(Equal),
          consume(Equal),
          consume(Equal),
        ]),
      ),
      and([consume(NewLine), consume(Equal), consume(Equal), consume(Equal)]),
    ],
    ([content]) => ({
      type: "h",
      size: 1,
      content,
    }),
  );

  BLOCK_QUOTE.set = and(
    [
      oneOrManySep(
        // Simplified inner rule: just parse '> content'
        and(
          [consume(Gt), zeroOrMany(consume(Whitespace)), zeroOrMany(BLOCK)],
          ([, content]) => content,
        ),
        consume(NewLine),
      ),
    ] as const,
    ([content]: [string[]]) => ({
      type: "q",
      content,
    }),
  );

  TEXT.set = oneOrMany(
    or([
      INLINE_TEXT,
      and([consume(NewLine), peek(not(consume(NewLine)))], () => "\n"),
    ]),
    (content) => ({
      type: "p",
      content,
    }),
  );

  INLINE_TEXT.set = or([
    BOLD,
    BOLD2,
    ITALIC,
    ITALIC2,
    INLINE_CODE,
    consume(Anything),
  ]);

  BOLD.set = and(
    [
      consume(Star),
      consume(Star),
      oneOrMany(
        or([ITALIC2, INLINE_CODE, consume(Anything)]),
        undefined,
        and([consume(Star), consume(Star)]),
      ),
      consume(Star),
      consume(Star),
    ],
    ([, , content]) => ({
      type: "b",
      content,
    }),
  );

  BOLD2.set = and(
    [
      not(peek(consumeBehind(Word))),
      consume(Underscore),
      consume(Underscore),
      consumeUntil(and([consume(Underscore), consume(Underscore)])),
      consume(Underscore),
      consume(Underscore),
      not(peek(consume(Word))),
    ],
    ([, , , content]) => ({
      type: "b",
      content,
    }),
  );

  ITALIC.set = and(
    [consume(Star), consumeUntil(Star), consume(Star)],
    ([, content]) => ({
      type: "i",
      content,
    }),
  );

  ITALIC2.set = and(
    [
      not(peek(consumeBehind(Word))),
      consume(Underscore),
      consumeUntil(Underscore),
      consume(Underscore),
      not(peek(consume(Word))),
    ],
    ([, , content]) => ({
      type: "i",
      content,
    }),
  );

  INLINE_CODE.set = and(
    [consume(Tilde), consumeUntil(Tilde), consume(Tilde)],
    ([, content]) => ({
      type: "c",
      content,
    }),
  );

  const [output] = throwIfError(and([PROGRAM, consume(EOF)]));

  return output;
}
