// deno-lint-ignore-file ban-unused-ignore no-explicit-any no-unused-vars ban-types
import {
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

  function BlockHeading() {
    return and(
      [
        oneOrMany(consume(Hash)),
        oneOrMany(consume(Whitespace)),
        oneOrMany(InlineText),
      ],
      ([hash, _, content]) => ({
        type: "h",
        size: hash.length,
        content,
      }),
    )();
  }

  function BlockHeadingWithUnderline() {
    return and(
      [
        oneOrMany(
          InlineText,
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
    )();
  }

  function BlockQuote() {
    return and(
      [
        oneOrManySep(
          // Simplified inner rule: just parse '> content'
          and([consume(Gt), zeroOrMany(consume(Whitespace)), zeroOrMany(Block)], ([, content]) => content),
          consume(NewLine),
        ),
      ] as const,
      ([content]: [string[]]) => ({
        type: "q",
        content,
      }),
    )();
  }

  function Block() {
    return or([BlockQuote, BlockHeading, BlockHeadingWithUnderline, Text])();
  }

  function Bold() {
    return and(
      [
        consume(Star),
        consume(Star),
        oneOrMany(
          or([Italic2, InlineCode, consume(Anything)]),
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
    )();
  }

  function Bold2() {
    return and(
      [
				not(peek(consumeBehind(Word))),
        consume(Underscore),
        consume(Underscore),
        consumeUntil(Underscore),
        consume(Underscore),
        consume(Underscore),
				not(peek(consume(Word))),
      ],
      ([, , , content]) => ({
        type: "b",
        content,
      }),
    )();
  }

  function Italic() {
    return and(
      [consume(Star), consumeUntil(Star), consume(Star)],
      ([, content]) => ({
        type: "i",
        content,
      }),
    )();
  }

  function Italic2() {
    return and(
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
    )();
  }

  function InlineCode() {
    return and(
      [consume(Tilde), consumeUntil(Tilde), consume(Tilde)],
      ([, content]) => ({
        type: "c",
        content,
      }),
    )();
  }

  function InlineText() {
    return or([
      Bold,
      Bold2,
      Italic,
      Italic2,
      InlineCode,
      consume(Anything),
    ])();
  }

  function Text() {
    return oneOrMany(
      or([
        InlineText,
        and([consume(NewLine), peek(not(consume(NewLine)))], () => "\n"),
      ]),
      (content) => ({
        type: "p",
        content,
      }),
    )();
  }

  function Program() {
    return zeroOrMany(
      and([zeroOrMany(consume(NewLine)), Block, zeroOrMany(consume(NewLine))]),
      (a) => a.flat(2),
    )();
  }

  const [output] = throwIfError(and([Program, consume(EOF)]));

  return output;
}
