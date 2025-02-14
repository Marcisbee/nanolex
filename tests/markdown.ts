// deno-lint-ignore-file ban-unused-ignore no-explicit-any no-unused-vars ban-types
import {
  createToken,
  EOF,
  getComposedTokens,
  nanolex,
} from "../src/nanolex.ts";

const Whitespace = createToken(/[ \t]+/);
const NewLine = createToken(/[\n\r]+/);
const Anything = createToken(/.*/);
const Hash = createToken("#");
const Star = createToken("*");
const Underscore = createToken("_");
const Tilde = createToken("`");
const Lt = createToken("<");
const Gt = createToken(">");

const tokens = getComposedTokens([
  Whitespace,
  NewLine,
  Hash,
  Star,
  Underscore,
  Tilde,
  Lt,
  Gt,
]);

export function parser(value: string) {
  const {
    consume,
    consumeUntil,
    oneOrMany,
    zeroOrMany,
    and,
    or,
    peek,
    throwIfError,
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

  function Block() {
    return or([BlockHeading, Text])();
  }

  function Bold() {
    return and(
      [
        consume(Star),
        consume(Star),
        oneOrMany(
          or([Italic2, InlineCode, consume(Anything)]),
          undefined,
          peek(and([consume(Star), consume(Star)])),
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
        consume(Underscore),
        consume(Underscore),
        consumeUntil(Underscore),
        consume(Underscore),
        consume(Underscore),
      ],
      ([, , content]) => ({
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
      [consume(Underscore), consumeUntil(Underscore), consume(Underscore)],
      ([, content]) => ({
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
    return or([Bold, Bold2, Italic, Italic2, InlineCode, consume(Anything)])();
  }

  function Text() {
    return oneOrMany(InlineText, (content) => ({
      type: "p",
      content,
    }))();
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
