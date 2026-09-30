/** Test-only declaration grammar. See typescript.md for sources and scope. */
import {
  and,
  consume,
  consumeAny,
  type Context,
  createParser,
  createToken,
  EOF,
  type Grammar,
  not,
  oneOrManySep,
  or,
  peek,
  rule,
  SourceCursor,
  sourcePattern,
  zeroOrMany,
  zeroOrOne,
} from "../src/nanolex.ts";

export interface Node {
  kind: string;
  start: number;
  end: number;
  children: Node[];
  name?: string;
  operator?: string;
  modifiers?: string[];
  optional?: boolean;
  rest?: boolean;
  docs?: JSDoc[];
}
export interface JSDocLink {
  kind: "link" | "linkcode" | "linkplain";
  target: string;
  label: string;
  raw: string;
}
export interface JSDocTag {
  name: string;
  text: string;
  description?: string;
  links: JSDocLink[];
  type?: string;
  parameter?: string;
  optional?: boolean;
  default?: string;
}
export interface JSDoc {
  start: number;
  end: number;
  raw: string;
  description: string;
  links: JSDocLink[];
  tags: JSDocTag[];
}
export interface DeclarationFile extends Node {
  kind: "DeclarationFile";
  source: string;
  comments: Comment[];
}
export interface Comment {
  kind: "line" | "block" | "jsdoc" | "directive";
  start: number;
  end: number;
  raw: string;
  doc?: JSDoc;
  directive?: { name: string; attributes: Record<string, string> };
}
interface Lexeme {
  text: string;
  kind: string;
  start: number;
  end: number;
  docs: JSDoc[];
  newline: boolean;
}
class ParseFailure extends Error {
  constructor(readonly offset: number, readonly expected: string) {
    super(`Expected ${expected} at ${offset}`);
  }
}

const docLink = createToken(
  /\{@(?:link|linkcode|linkplain)\s+[^}]+\}/,
  "JSDoc link",
);
const docTag = createToken(/(?:^|[ \t\n])@[\w-]+\b[ \t]*/, "JSDoc tag");
const docFence = createToken(/```[\s\S]*?(?:```|$)/, "JSDoc fenced example");
const docParser = createParser([docFence, docLink, docTag], {
  PROSE(): Grammar<string> {
    return zeroOrMany(
      and([not(consume(docTag)), consumeAny()], ([, value]) => value),
      (parts) => parts.join(""),
    );
  },
  DOCUMENT(): Grammar<{ description: string; tags: JSDocTag[] }> {
    return and([
      rule(this.PROSE),
      zeroOrMany(and([consume(docTag), rule(this.PROSE)], ([marker, text]) => ({
        name: marker.trim().slice(1).trim(),
        text: text.trim(),
        links: jsdocLinks(text),
      }))),
    ], ([description, tags]) => ({ description: description.trim(), tags }));
  },
  LINKS(): Grammar<JSDocLink[]> {
    return zeroOrMany(
      or([
        consume(docLink, (raw): JSDocLink => {
          const match =
            /^\{@(link|linkcode|linkplain)\s+([^\s|}]+)(?:\s*\|?\s*([^}]*))?\}$/
              .exec(raw)!;
          return {
            kind: match[1] as JSDocLink["kind"],
            target: match[2],
            label: match[3] ?? "",
            raw,
          };
        }),
        and([consumeAny()], () => undefined),
      ]),
      (links) =>
        links.filter((value): value is JSDocLink => value !== undefined),
    );
  },
});
function jsdocLinks(text: string): JSDocLink[] {
  return text.includes("{@") ? docParser("LINKS", text) : [];
}

const docOpen = createToken("{");
const docClose = createToken("}");
const docQuoted = createToken(
  /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/,
);
const docEscape = createToken(/\\[\s\S]/);
const annotationParser = createParser(
  [docQuoted, docEscape, docOpen, docClose],
  {
    BRACED(): Grammar<string> {
      return and([
        consume(docOpen),
        zeroOrMany(
          or([
            rule(this.BRACED),
            and(
              [not(or([consume(docOpen), consume(docClose)])), consumeAny()],
              ([, value]) => value,
            ),
          ]),
          (parts) => parts.join(""),
        ),
        consume(docClose),
      ], ([open, body, close]) => open + body + close);
    },
    ANNOTATION(): Grammar<{ type?: string; tail: string }> {
      return and([
        zeroOrOne(rule(this.BRACED)),
        zeroOrMany(consumeAny(), (parts) => parts.join("")),
      ], ([type, tail]) => ({ type: type?.slice(1, -1), tail: tail.trim() }));
    },
  },
);

/** Unknown tags and all original comment text are deliberately retained. */
export function parseJSDoc(raw: string, start = 0): JSDoc {
  const text = raw.slice(3, -2).replace(/\r\n?/g, "\n")
    .split("\n").map((line) => line.replace(/^\s*\* ?/, "")).join("\n").trim();
  const { description, tags } = docParser("DOCUMENT", text);
  for (const tag of tags) {
    let { type, tail } = tag.text.startsWith("{")
      ? annotationParser("ANNOTATION", tag.text)
      : { type: undefined, tail: tag.text };
    if (type !== undefined) tag.type = type;
    if (
      [
        "param",
        "arg",
        "argument",
        "property",
        "prop",
        "template",
        "typedef",
        "callback",
      ].includes(tag.name)
    ) {
      const match = /^(\[[^\]]+\]|[^\s]+)(?:\s|$)/.exec(tail);
      if (match) {
        let name = match[1];
        if (name.startsWith("[")) {
          tag.optional = true;
          name = name.slice(1, -1);
          const equal = name.indexOf("=");
          if (equal !== -1) {
            tag.default = name.slice(equal + 1);
            name = name.slice(0, equal);
          }
        }
        tag.parameter = name;
        tail = tail.slice(match[0].length).trim();
      }
    }
    tag.description = tail.replace(/^-\s*/, "");
  }
  return {
    start,
    end: start + raw.length,
    raw,
    description,
    links: jsdocLinks(description),
    tags,
  };
}

const identifier = sourcePattern(
  /(?:[$_\p{ID_Start}]|\\u(?:[\da-fA-F]{4}|\{[\da-fA-F]+\}))(?:[$\u200c\u200d\p{ID_Continue}]|\\u(?:[\da-fA-F]{4}|\{[\da-fA-F]+\}))*/u,
);
const number = sourcePattern(
  /(?:0[xX][\da-fA-F](?:_?[\da-fA-F])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?)n?/,
);
const whitespace = sourcePattern(/\s+/u);
function lex(cursor: SourceCursor): { tokens: Lexeme[]; comments: Comment[] } {
  const tokens: Lexeme[] = [], comments: Comment[] = [];
  let docs: JSDoc[] = [], newline = false;
  const templates: number[] = [];
  const context = { cursor, state: undefined };
  const emit = (kind: string, start: number) => {
    tokens.push({
      kind,
      start,
      end: cursor.offset,
      text: cursor.slice(start),
      docs,
      newline,
    });
    docs = [];
    newline = false;
  };
  const template = (start: number, continuation: boolean) => {
    cursor.advance();
    while (!cursor.eof) {
      if (cursor.consume("\\")) {
        cursor.advance();
        continue;
      }
      if (cursor.consume("`")) {
        emit(continuation ? "templateTail" : "templateLiteral", start);
        return;
      }
      if (cursor.consume("${")) {
        templates.push(0);
        emit(continuation ? "templateMiddle" : "templateHead", start);
        return;
      }
      cursor.advance();
    }
    throw new ParseFailure(start, "closing backtick");
  };
  while (!cursor.eof) {
    const start = cursor.offset;
    const ws = whitespace(context);
    if (ws[1] === null) {
      newline ||= /[\r\n\u2028\u2029]/.test(ws[0][0]);
      continue;
    }
    if (cursor.consume("//")) {
      cursor.consumeWhile((c) => !/[\r\n\u2028\u2029]/.test(c));
      const raw = cursor.slice(start);
      const directiveMatch = /^\/\/\/\s*<([\w-]+)\b(.*?)\/?>\s*$/.exec(raw);
      const directive = directiveMatch
        ? {
          name: directiveMatch[1],
          attributes: Object.fromEntries(
            [...directiveMatch[2].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)]
              .map((m) => [m[1], m[3]]),
          ),
        }
        : undefined;
      comments.push({
        kind: directive ? "directive" : "line",
        start,
        end: cursor.offset,
        raw,
        directive,
      });
      continue;
    }
    if (cursor.consume("/*")) {
      const end = cursor.input.indexOf("*/", cursor.offset);
      if (end < 0) throw new ParseFailure(start, "closing comment");
      cursor.advance(end + 2 - cursor.offset);
      const raw = cursor.slice(start);
      const doc = raw.startsWith("/**") && raw !== "/**/"
        ? parseJSDoc(raw, start)
        : undefined;
      comments.push({
        kind: doc ? "jsdoc" : "block",
        start,
        end: cursor.offset,
        raw,
        doc,
      });
      if (doc) docs.push(doc);
      newline ||= /[\r\n\u2028\u2029]/.test(raw);
      continue;
    }
    const c = cursor.peek();
    if (c === '"' || c === "'") {
      cursor.advance();
      let closed = false;
      while (!cursor.eof) {
        if (cursor.consume("\\")) {
          if (cursor.consume("\r")) cursor.consume("\n");
          else cursor.advance();
          continue;
        }
        if (cursor.consume(c)) {
          closed = true;
          break;
        }
        if (/[\r\n\u2028\u2029]/.test(cursor.peek()!)) break;
        cursor.advance();
      }
      if (!closed) throw new ParseFailure(start, "closing quote");
      emit("string", start);
      continue;
    }
    if (c === "`") {
      template(start, false);
      continue;
    }
    if (
      c === "}" && templates.length && templates[templates.length - 1] === 0
    ) {
      templates.pop();
      template(start, true);
      continue;
    }
    if (number(context)[1] === null) {
      emit("number", start);
      continue;
    }
    if (identifier(context)[1] === null) {
      emit("identifier", start);
      continue;
    }
    const punct = ["...", "=>", "**", "&&", "||", "??", "==", "!=", "?."].find((
      p,
    ) => cursor.input.startsWith(p, start));
    if (punct) cursor.advance(punct.length);
    else if (c && "{}[]()<>,;:.?=+-*/%&|^!~#@".includes(c)) cursor.advance();
    else throw new ParseFailure(start, "declaration token");
    if (templates.length) {
      if (c === "{") templates[templates.length - 1]++;
      if (c === "}") templates[templates.length - 1]--;
    }
    emit("punctuation", start);
  }
  tokens.push({
    text: "",
    kind: "eof",
    start: cursor.offset,
    end: cursor.offset,
    docs,
    newline,
  });
  return { tokens, comments };
}

// The lexer owns lexical context (comments, template boundaries and line breaks).
// All syntactic choice, sequencing, recursion and repetition below use Nanolex.
interface DeclarationContext extends Context {
  lexemes: Lexeme[];
}
const token = (ctx: Context, pos = ctx.pos) =>
  (ctx as DeclarationContext).lexemes[pos];
const literals = new Map<string, Grammar<string>>();
function text(value: string): Grammar<string> {
  let grammar = literals.get(value);
  if (!grammar) {
    grammar = consume(createToken(value));
    literals.set(value, grammar);
  }
  return grammar;
}
// One token test for a keyword/punctuation set, rather than a failed parser
// invocation and result tuple for every preceding alternative.
const either = (...values: string[]) =>
  consume(createToken(
    new RegExp(
      `(?:${values.map((value) => createToken(value).source).join("|")})`,
    ),
  ));
function condition(
  name: string,
  test: (ctx: Context) => boolean,
): Grammar<null> {
  const expected = createToken(name);
  return (ctx) => test(ctx) ? [null, null] : [ctx.pos, expected];
}
function category(kind: string): Grammar<string> {
  return and([
    condition(kind, (ctx) => token(ctx).kind === kind),
    consume(createToken(/[\s\S]+/, kind)),
  ], ([, value]) => value);
}
const sameLine = condition("no line break", (ctx) => !token(ctx).newline);
const lineBreak = condition("line break", (ctx) => token(ctx).newline);
const identifierToken = category("identifier");
const stringToken = category("string");
const numberToken = category("number");
const semicolon = or([
  text(";"),
  peek(text("}")),
  peek(consume(EOF)),
  lineBreak,
]);
const present = <T>(value: T | undefined): T[] =>
  value === undefined ? [] : [value];
type Shape = Partial<Omit<Node, "start" | "end">>;
function located<T>(
  grammar: Grammar<T>,
  build: (value: T) => Shape,
  kind = "",
): Grammar<Node> {
  return (ctx) => {
    const first = token(ctx);
    const result = grammar(ctx);
    if (result[1] !== null) return result;
    const shape = build(result[0]);
    // A precedence level with no operator returns its child unchanged.
    if ("start" in shape && "end" in shape) {
      const value = shape as Node;
      return [
        first.docs.length && first.docs !== value.docs
          ? { ...value, docs: first.docs }
          : value,
        null,
      ];
    }
    const last = token(ctx, Math.max(0, ctx.pos - 1));
    const value: Node = {
      kind,
      children: [],
      start: first.start,
      end: last.end,
      ...shape,
    };
    if (first.docs.length) value.docs = first.docs;
    return [value, null];
  };
}
const node = <T>(
  kind: string,
  grammar: Grammar<T>,
  build: (value: T) => Shape = () => ({}),
) => located(grammar, build, kind);
const named = (grammar: Grammar<string>) =>
  node("Name", grammar, (name) => ({ name }));
const id = named(identifierToken);
const name = named(or([identifierToken, stringToken, numberToken]));
const moduleName = named(stringToken);
function after<T>(prefix: string, grammar: Grammar<T>): Grammar<T> {
  return and([text(prefix), grammar], ([, value]) => value);
}
function between<T>(
  open: string,
  grammar: Grammar<T>,
  close: string,
): Grammar<T> {
  return and([text(open), grammar, text(close)], ([, value]) => value);
}
// A list may be empty and have one trailing comma, but not an empty element.
function list<T>(grammar: Grammar<T>, close: string): Grammar<T[]> {
  return and([
    zeroOrOne(
      and(
        [grammar, zeroOrMany(after(",", grammar)), zeroOrOne(text(","))],
        ([first, rest]) => [first, ...rest],
      ),
    ),
    text(close),
  ], ([items]) => items ?? []);
}
function modifiers(
  values: string[],
  following: Grammar<unknown>,
): Grammar<string[]> {
  return zeroOrMany(
    and([either(...values), peek(following)], ([value]) => value),
  );
}
function extend(
  left: Node,
  kind: string,
  children: Node[],
  end: number,
  fields: Shape = {},
): Node {
  return {
    kind,
    start: left.start,
    end,
    children,
    ...(left.docs ? { docs: left.docs } : {}),
    ...fields,
  };
}
const memberModifiers = [
  "public",
  "private",
  "protected",
  "static",
  "abstract",
  "readonly",
  "override",
  "declare",
  "accessor",
];
const parameterModifiers = [
  "public",
  "private",
  "protected",
  "readonly",
  "override",
];
const memberNameFollower = not(either("(", "<", ":", "?", ";", "}", ",", "="));

function unionGrammar(conditional: boolean): Grammar<Node> {
  return located(
    and([
      zeroOrOne(text("|")),
      intersectionGrammar(conditional),
      zeroOrMany(after("|", intersectionGrammar(conditional))),
    ]),
    ([, first, rest]) =>
      rest.length ? { kind: "UnionType", children: [first, ...rest] } : first,
  );
}
function intersectionGrammar(conditional: boolean): Grammar<Node> {
  const prefix = rule(conditional ? grammar.PREFIX : grammar.CONSTRAINT_PREFIX);
  return located(
    and([
      zeroOrOne(text("&")),
      prefix,
      zeroOrMany(after("&", prefix)),
    ]),
    ([, first, rest]) =>
      rest.length
        ? { kind: "IntersectionType", children: [first, ...rest] }
        : first,
  );
}
function prefixGrammar(conditional: boolean): Grammar<Node> {
  const prefix = rule(conditional ? grammar.PREFIX : grammar.CONSTRAINT_PREFIX);
  const inferConstraint = after("extends", rule(grammar.CONSTRAINT));
  return or([
    node(
      "TypeOperator",
      and([either("keyof", "readonly", "unique"), prefix]),
      ([operator, value]) => ({ operator, children: [value] }),
    ),
    node(
      "InferType",
      and([
        text("infer"),
        id,
        zeroOrOne(
          conditional
            ? and([inferConstraint, not(text("?"))], ([value]) => value)
            : inferConstraint,
        ),
      ]),
      ([, name, constraint]) => ({ children: [name, ...present(constraint)] }),
    ),
    node(
      "TypePredicate",
      and([text("asserts"), id, zeroOrOne(after("is", rule(grammar.TYPE)))]),
      ([, name, value]) => ({
        operator: "asserts",
        children: [name, ...present(value)],
      }),
    ),
    node(
      "ConstructorType",
      and([
        zeroOrOne(text("abstract")),
        text("new"),
        rule(grammar.SIGNATURE),
        text("=>"),
        rule(grammar.TYPE),
      ]),
      ([abstract, , signature, , value]) => ({
        modifiers: present(abstract),
        children: [...signature, value],
      }),
    ),
    node(
      "FunctionType",
      and([rule(grammar.SIGNATURE), text("=>"), rule(grammar.TYPE)]),
      ([signature, , value]) => ({ children: [...signature, value] }),
    ),
    and(
      [
        rule(grammar.POSTFIX_TYPE),
        zeroOrOne(and([sameLine, text("is"), rule(grammar.TYPE)])),
      ],
      ([left, predicate]) =>
        predicate
          ? extend(
            left,
            "TypePredicate",
            [
              left.kind === "TypeReference" && left.children.length === 1
                ? left.children[0]
                : left,
              predicate[2],
            ],
            predicate[2].end,
            { operator: "is" },
          )
          : left,
    ),
  ]);
}
function templateGrammar(kind: string, value: Grammar<Node>): Grammar<Node> {
  const part = (categoryName: string) =>
    node("TemplateText", category(categoryName), (name) => ({ name }));
  return node(
    kind,
    or([
      and([part("templateLiteral")], ([part]) => [part]),
      and(
        [
          part("templateHead"),
          zeroOrMany(and([value, part("templateMiddle")])),
          value,
          part("templateTail"),
        ],
        ([head, middle, value, tail]) => [head, ...middle.flat(), value, tail],
      ),
    ]),
    (children) => ({ children }),
  );
}
function members(classMember: boolean): Grammar<Node[]> {
  return zeroOrMany(
    or([
      and([text(";")], () => [] as Node[]),
      and(
        [member(classMember), or([text(","), semicolon])],
        ([value]) => [value],
      ),
    ]),
    (items) => items.flat(),
  );
}
function member(classMember: boolean): Grammar<Node> {
  const signature = and([
    rule(grammar.SIGNATURE),
    zeroOrOne(after(":", rule(grammar.TYPE))),
  ], ([parameters, result]) => [...parameters, ...present(result)]);
  return located(
    and([
      modifiers(memberModifiers, memberNameFollower),
      or([
        ...(classMember ? [] : [
          located(
            and([zeroOrOne(text("new")), signature]),
            ([construct, children]) => ({
              kind: construct ? "ConstructSignature" : "CallSignature",
              children,
            }),
          ),
        ]),
        node(
          "IndexSignature",
          and([
            text("["),
            id,
            text(":"),
            rule(grammar.TYPE),
            text("]"),
            text(":"),
            rule(grammar.TYPE),
          ]),
          ([, name, , index, , , value]) => ({
            children: [name, index, value],
          }),
        ),
        located(
          and([
            zeroOrOne(
              and(
                [either("get", "set"), peek(memberNameFollower)],
                ([value]) => value,
              ),
            ),
            or([
              node(
                "ComputedName",
                between("[", rule(grammar.EXPRESSION), "]"),
                (value) => ({ children: [value] }),
              ),
              node(
                "PrivateName",
                after("#", id),
                (value) => ({ name: `#${value.name}`, children: [value] }),
              ),
              name,
            ]),
            zeroOrOne(text("?")),
            or([
              and([signature], ([children]) => ({ method: true, children })),
              and(
                [
                  zeroOrOne(after(":", rule(grammar.TYPE))),
                  zeroOrOne(after("=", rule(grammar.EXPRESSION))),
                ],
                ([type, value]) => ({
                  method: false,
                  children: [...present(type), ...present(value)],
                }),
              ),
            ]),
          ]),
          ([accessor, name, optional, tail]) => ({
            kind: tail.method
              ? classMember && name.name === "constructor"
                ? "Constructor"
                : accessor === "get"
                ? "GetAccessor"
                : accessor === "set"
                ? "SetAccessor"
                : "MethodSignature"
              : "PropertySignature",
            name: name.name,
            optional: !!optional,
            modifiers: present(accessor),
            children: [name, ...tail.children],
          }),
        ),
      ]),
    ]),
    ([modifiers, value]) => ({
      kind: value.kind,
      name: value.name,
      optional: value.optional,
      children: value.children,
      modifiers: [...modifiers, ...(value.modifiers ?? [])],
    }),
  );
}
// Operator precedence is a stack of sequence/repetition grammars. The folds only
// construct ASTs; they never advance the parser or decide which tokens to read.
function binary(
  lower: Grammar<Node>,
  operators: Grammar<string>,
): Grammar<Node> {
  return and(
    [lower, zeroOrMany(and([operators, lower]))],
    ([first, rest]) =>
      rest.reduce(
        (left, [operator, right]) =>
          extend(left, "BinaryExpression", [left, right], right.end, {
            operator,
          }),
        first,
      ),
  );
}
function expression(heritage: boolean): Grammar<Node> {
  const power = rule(heritage ? grammar.HERITAGE_POWER : grammar.POWER);
  const product = binary(power, either("*", "/", "%"));
  const sum = binary(product, either("+", "-"));
  const shift = (value: string) =>
    and([
      condition(value, (ctx) => {
        const count = value.length;
        const parts = (ctx as DeclarationContext).lexemes.slice(
          ctx.pos,
          ctx.pos + count,
        );
        return parts.length === count && parts.every((part, i) =>
          part.text === value[i] && (!i || parts[i - 1].end === part.start)
        );
      }),
      ...Array.from(value, text),
    ], () => value);
  const shifts = binary(sum, or([shift(">>>"), shift(">>"), shift("<<")]));
  return binary(
    binary(
      binary(binary(binary(shifts, text("&")), text("^")), text("|")),
      text("&&"),
    ),
    either("||", "??"),
  );
}
function power(heritage: boolean): Grammar<Node> {
  return and(
    [
      rule(heritage ? grammar.UNARY_HERITAGE : grammar.UNARY),
      zeroOrOne(
        after("**", rule(heritage ? grammar.HERITAGE_POWER : grammar.POWER)),
      ),
    ],
    ([left, right]) =>
      right
        ? extend(left, "BinaryExpression", [left, right], right.end, {
          operator: "**",
        })
        : left,
  );
}
function unary(heritage: boolean): Grammar<Node> {
  return or([
    node(
      "UnaryExpression",
      and([
        either("+", "-", "~", "!"),
        rule(heritage ? grammar.UNARY_HERITAGE : grammar.UNARY),
      ]),
      ([operator, value]) => ({ operator, children: [value] }),
    ),
    and(
      [
        or([
          node(
            "ParenthesizedExpression",
            between(
              "(",
              rule(heritage ? grammar.HERITAGE_EXPRESSION : grammar.EXPRESSION),
              ")",
            ),
            (value) => ({ children: [value] }),
          ),
          templateGrammar("TemplateExpression", rule(grammar.EXPRESSION)),
          name,
        ]),
        zeroOrMany(or([
          node(
            "CallExpression",
            after("(", list(rule(grammar.EXPRESSION), ")")),
            (children) => ({ children }),
          ),
          node(
            "PropertyAccess",
            after(".", id),
            (value) => ({ children: [value] }),
          ),
          node(
            "ElementAccess",
            between("[", rule(grammar.EXPRESSION), "]"),
            (value) => ({ children: [value] }),
          ),
          ...(heritage
            ? [
              node(
                "ExpressionWithTypeArguments",
                after("<", list(rule(grammar.TYPE), ">")),
                (children) => ({ children }),
              ),
            ]
            : []),
        ])),
      ],
      ([first, rest]) =>
        rest.reduce(
          (left, suffix) =>
            extend(left, suffix.kind, [left, ...suffix.children], suffix.end),
          first,
        ),
    ),
  ]);
}

const grammar = {
  QUALIFIED(): Grammar<Node> {
    return node(
      "QualifiedName",
      and([id, zeroOrMany(after(".", id))]),
      ([first, rest]) => ({
        children: [first, ...rest],
        name: [first, ...rest].map((n) => n.name).join("."),
      }),
    );
  },
  TYPE_PARAMETERS(): Grammar<Node[]> {
    return and(
      [zeroOrOne(after("<", list(rule(this.TYPE_PARAMETER), ">")))],
      ([items]) => items ?? [],
    );
  },
  TYPE_PARAMETER(): Grammar<Node> {
    return node(
      "TypeParameter",
      and([
        modifiers(["const", "in", "out"], identifierToken),
        id,
        zeroOrOne(
          after(
            "extends",
            node(
              "Constraint",
              rule(this.TYPE),
              (value) => ({ children: [value] }),
            ),
          ),
        ),
        zeroOrOne(
          after(
            "=",
            node(
              "DefaultType",
              rule(this.TYPE),
              (value) => ({ children: [value] }),
            ),
          ),
        ),
      ]),
      ([modifiers, name, constraint, value]) => ({
        name: name.name,
        modifiers,
        children: [name, ...present(constraint), ...present(value)],
      }),
    );
  },
  TYPE_ARGUMENTS(): Grammar<Node[]> {
    return and(
      [zeroOrOne(after("<", list(rule(this.TYPE), ">")))],
      ([items]) => items ?? [],
    );
  },
  SIGNATURE(): Grammar<Node[]> {
    return and([
      rule(this.TYPE_PARAMETERS),
      text("("),
      list(rule(this.PARAMETER), ")"),
    ], ([types, , parameters]) => [...types, ...parameters]);
  },
  PARAMETER(): Grammar<Node> {
    return node(
      "Parameter",
      and([
        modifiers(parameterModifiers, identifierToken),
        zeroOrOne(text("...")),
        rule(this.BINDING),
        zeroOrOne(text("?")),
        zeroOrOne(after(":", rule(this.TYPE))),
      ]),
      ([modifiers, rest, name, optional, type]) => ({
        modifiers,
        rest: !!rest,
        optional: !!optional,
        name: name.name,
        children: [name, ...present(type)],
      }),
    );
  },
  BINDING(): Grammar<Node> {
    return or([
      node(
        "ObjectBinding",
        after(
          "{",
          list(
            node(
              "BindingElement",
              and([
                zeroOrOne(text("...")),
                name,
                zeroOrOne(after(":", rule(this.BINDING))),
              ]),
              ([rest, name, binding]) => ({
                rest: !!rest,
                children: [name, ...present(binding)],
              }),
            ),
            "}",
          ),
        ),
        (children) => ({ children }),
      ),
      node(
        "ArrayBinding",
        between(
          "[",
          zeroOrMany(or([
            node("OmittedBinding", text(",")),
            and([
              node(
                "BindingElement",
                and([zeroOrOne(text("...")), rule(this.BINDING)]),
                ([rest, value]) => ({ rest: !!rest, children: [value] }),
              ),
              or([text(","), peek(text("]"))]),
            ], ([value]) => value),
          ])),
          "]",
        ),
        (children) => ({ children }),
      ),
      id,
    ]);
  },
  TYPE(): Grammar<Node> {
    return and(
      [
        rule(this.UNION),
        zeroOrOne(and([
          sameLine,
          text("extends"),
          rule(this.CONSTRAINT),
          text("?"),
          rule(this.TYPE),
          text(":"),
          rule(this.TYPE),
        ])),
      ],
      ([left, tail]) =>
        tail
          ? extend(
            left,
            "ConditionalType",
            [left, tail[2], tail[4], tail[6]],
            tail[6].end,
          )
          : left,
    );
  },
  CONSTRAINT(): Grammar<Node> {
    return unionGrammar(false);
  },
  UNION(): Grammar<Node> {
    return unionGrammar(true);
  },
  PREFIX(): Grammar<Node> {
    return prefixGrammar(true);
  },
  CONSTRAINT_PREFIX(): Grammar<Node> {
    return prefixGrammar(false);
  },
  POSTFIX_TYPE(): Grammar<Node> {
    return and(
      [
        rule(this.PRIMARY_TYPE),
        zeroOrMany(
          node(
            "TypeSuffix",
            and([sameLine, text("["), zeroOrOne(rule(this.TYPE)), text("]")]),
            ([, , index]) => ({ children: present(index) }),
          ),
        ),
      ],
      ([first, rest]) =>
        rest.reduce((left, suffix) =>
          extend(
            left,
            suffix.children.length ? "IndexedAccessType" : "ArrayType",
            [left, ...suffix.children],
            suffix.end,
          ), first),
    );
  },
  PRIMARY_TYPE(): Grammar<Node> {
    return or([
      node(
        "ParenthesizedType",
        between("(", rule(this.TYPE), ")"),
        (value) => ({ children: [value] }),
      ),
      rule(this.OBJECT_TYPE),
      node(
        "TupleType",
        after("[", list(rule(this.TUPLE_ELEMENT), "]")),
        (children) => ({ children }),
      ),
      node(
        "ImportType",
        after("typeof", rule(this.IMPORT_TYPE)),
        (value) => ({ operator: "typeof", children: value.children }),
      ),
      node(
        "TypeQuery",
        and([text("typeof"), rule(this.QUALIFIED), rule(this.TYPE_ARGUMENTS)]),
        ([, name, args]) => ({ children: [name, ...args] }),
      ),
      rule(this.IMPORT_TYPE),
      templateGrammar("TemplateLiteralType", rule(this.TYPE)),
      node(
        "LiteralType",
        or([
          stringToken,
          numberToken,
          either("true", "false", "null"),
          and([text("-"), numberToken], ([minus, value]) => minus + value),
        ]),
        (name) => ({ name }),
      ),
      node(
        "KeywordType",
        and([
          either(
            "any",
            "unknown",
            "never",
            "void",
            "undefined",
            "string",
            "number",
            "boolean",
            "bigint",
            "symbol",
            "object",
            "this",
            "intrinsic",
          ),
          not(text(".")),
        ]),
        ([name]) => ({ name }),
      ),
      node(
        "TypeReference",
        and([rule(this.QUALIFIED), rule(this.TYPE_ARGUMENTS)]),
        ([name, args]) => ({ name: name.name, children: [name, ...args] }),
      ),
    ]);
  },
  TUPLE_ELEMENT(): Grammar<Node> {
    return node(
      "TupleElement",
      and([
        zeroOrOne(text("...")),
        or([
          and(
            [id, zeroOrOne(text("?")), text(":"), rule(this.TYPE)],
            ([name, optional, , value]) => ({
              name: name.name,
              optional: !!optional,
              children: [name, value],
            }),
          ),
          and(
            [rule(this.TYPE), zeroOrOne(text("?"))],
            ([value, optional]) => ({
              optional: !!optional,
              children: [value],
            }),
          ),
        ]),
      ]),
      ([rest, value]) => ({ ...value, rest: !!rest }),
    );
  },
  IMPORT_TYPE(): Grammar<Node> {
    return node(
      "ImportType",
      and([
        text("import"),
        text("("),
        moduleName,
        zeroOrOne(after(",", rule(this.ATTRIBUTES))),
        text(")"),
        zeroOrOne(after(".", rule(this.QUALIFIED))),
        rule(this.TYPE_ARGUMENTS),
      ]),
      ([, , name, attributes, , qualifier, args]) => ({
        children: [
          name,
          ...present(attributes),
          ...present(qualifier),
          ...args,
        ],
      }),
    );
  },
  ATTRIBUTES(): Grammar<Node> {
    return node(
      "ImportAttributes",
      after(
        "{",
        list(
          node(
            "ImportAttribute",
            and([
              name,
              text(":"),
              or([rule(this.ATTRIBUTES), name]),
            ]),
            ([name, , value]) => ({ children: [name, value] }),
          ),
          "}",
        ),
      ),
      (children) => ({ children }),
    );
  },
  OBJECT_TYPE(): Grammar<Node> {
    return or([
      node(
        "MappedType",
        and([
          text("{"),
          zeroOrOne(
            and(
              [zeroOrOne(either("+", "-")), text("readonly")],
              ([sign, value]) => (sign ?? "") + value,
            ),
          ),
          text("["),
          id,
          text("in"),
          rule(this.TYPE),
          zeroOrOne(
            after(
              "as",
              node(
                "NameRemapping",
                rule(this.TYPE),
                (value) => ({ children: [value] }),
              ),
            ),
          ),
          text("]"),
          zeroOrOne(
            and(
              [zeroOrOne(either("+", "-")), text("?")],
              ([sign, value]) => (sign ?? "") + value,
            ),
          ),
          zeroOrOne(after(":", rule(this.TYPE))),
          zeroOrOne(text(";")),
          text("}"),
        ]),
        ([, readonly, , name, , type, remap, , optional, value]) => ({
          modifiers: [...present(readonly), ...present(optional)],
          children: [name, type, ...present(remap), ...present(value)],
        }),
      ),
      node(
        "TypeLiteral",
        between("{", members(false), "}"),
        (children) => ({ children }),
      ),
    ]);
  },
  EXPRESSION(): Grammar<Node> {
    return expression(false);
  },
  HERITAGE_EXPRESSION(): Grammar<Node> {
    return expression(true);
  },
  POWER(): Grammar<Node> {
    return power(false);
  },
  HERITAGE_POWER(): Grammar<Node> {
    return power(true);
  },
  UNARY(): Grammar<Node> {
    return unary(false);
  },
  UNARY_HERITAGE(): Grammar<Node> {
    return unary(true);
  },
  HERITAGE(): Grammar<Node[]> {
    return zeroOrMany(and([
      either("extends", "implements"),
      node(
        "HeritageClause",
        oneOrManySep(
          and(
            [rule(this.HERITAGE_EXPRESSION)],
            ([value]) =>
              value.kind === "ExpressionWithTypeArguments" ? value : extend(
                value,
                "ExpressionWithTypeArguments",
                [value],
                value.end,
              ),
          ),
          text(","),
        ),
        (children) => ({ children }),
      ),
    ], ([operator, clause]) => ({ ...clause, operator })));
  },
  CLASS(): Grammar<Node> {
    return node(
      "ClassDeclaration",
      and([
        text("class"),
        zeroOrOne(
          and([not(either("extends", "implements")), id], ([, value]) => value),
        ),
        rule(this.TYPE_PARAMETERS),
        rule(this.HERITAGE),
        text("{"),
        members(true),
        text("}"),
      ]),
      ([, name, parameters, heritage, , members]) => ({
        name: name?.name,
        children: [...present(name), ...parameters, ...heritage, ...members],
      }),
    );
  },
  INTERFACE(): Grammar<Node> {
    return node(
      "InterfaceDeclaration",
      and([
        text("interface"),
        id,
        rule(this.TYPE_PARAMETERS),
        rule(this.HERITAGE),
        text("{"),
        members(false),
        text("}"),
      ]),
      ([, name, parameters, heritage, , members]) => ({
        name: name.name,
        children: [name, ...parameters, ...heritage, ...members],
      }),
    );
  },
  FUNCTION(): Grammar<Node> {
    return node(
      "FunctionDeclaration",
      and([
        text("function"),
        zeroOrOne(id),
        rule(this.SIGNATURE),
        zeroOrOne(after(":", rule(this.TYPE))),
        semicolon,
      ]),
      ([, name, signature, type]) => ({
        name: name?.name,
        children: [...present(name), ...signature, ...present(type)],
      }),
    );
  },
  VARIABLE(): Grammar<Node> {
    return node(
      "VariableDeclaration",
      and([
        rule(this.BINDING),
        zeroOrOne(after(":", rule(this.TYPE))),
        zeroOrOne(after("=", rule(this.EXPRESSION))),
      ]),
      ([name, type, value]) => ({
        name: name.name,
        children: [name, ...present(type), ...present(value)],
      }),
    );
  },
  DECLARATION_BODY(): Grammar<Node> {
    return or([
      node(
        "TypeAliasDeclaration",
        and([
          text("type"),
          id,
          rule(this.TYPE_PARAMETERS),
          text("="),
          rule(this.TYPE),
          semicolon,
        ]),
        ([, name, parameters, , type]) => ({
          name: name.name,
          children: [name, ...parameters, type],
        }),
      ),
      rule(this.CLASS),
      rule(this.INTERFACE),
      rule(this.FUNCTION),
      node(
        "VariableStatement",
        and([
          either("const", "let", "var"),
          rule(this.VARIABLE),
          zeroOrMany(after(",", rule(this.VARIABLE))),
          semicolon,
        ]),
        ([operator, first, rest]) => ({ operator, children: [first, ...rest] }),
      ),
      node(
        "EnumDeclaration",
        and([
          text("enum"),
          id,
          text("{"),
          list(
            node(
              "EnumMember",
              and([name, zeroOrOne(after("=", rule(this.EXPRESSION)))]),
              ([name, value]) => ({
                name: name.name,
                children: [name, ...present(value)],
              }),
            ),
            "}",
          ),
        ]),
        ([, name, , members]) => ({
          name: name.name,
          children: [name, ...members],
        }),
      ),
      node(
        "ModuleDeclaration",
        and([
          or([
            and(
              [text("global")],
              ([operator]) => ({
                operator,
                name: undefined as Node | undefined,
              }),
            ),
            and([
              either("namespace", "module"),
              or([moduleName, rule(this.QUALIFIED)]),
            ], ([operator, name]) => ({ operator, name })),
          ]),
          or([
            between("{", rule(this.DECLARATIONS), "}"),
            and([semicolon], () => [] as Node[]),
          ]),
        ]),
        ([{ operator, name }, children]) => ({
          operator,
          name: name?.name ?? "global",
          children: [...present(name), ...children],
        }),
      ),
      rule(this.IMPORT),
    ]);
  },
  DECLARATION(): Grammar<Node> {
    return or([
      node("EmptyDeclaration", text(";")),
      rule(this.EXPORT),
      located(
        and([
          zeroOrMany(either("declare", "abstract")),
          zeroOrOne(
            and([text("const"), peek(text("enum"))], ([value]) => value),
          ),
          rule(this.DECLARATION_BODY),
        ]),
        ([modifiers, constant, value]) => ({
          kind: value.kind,
          children: value.children,
          name: value.name,
          operator: value.operator,
          modifiers: [
            ...modifiers,
            ...present(constant),
            ...(value.modifiers ?? []),
          ],
        }),
      ),
    ]);
  },
  EXPORT(): Grammar<Node> {
    return located(
      and([
        text("export"),
        or([
          node(
            "ExportAssignment",
            and([text("="), rule(this.EXPRESSION), semicolon]),
            ([operator, value]) => ({ operator, children: [value] }),
          ),
          node(
            "NamespaceExport",
            and([text("as"), text("namespace"), id, semicolon]),
            ([, , name]) => ({ name: name.name, children: [name] }),
          ),
          located(
            after(
              "default",
              or([
                located(
                  and([
                    zeroOrOne(text("abstract")),
                    or([
                      rule(this.CLASS),
                      rule(this.INTERFACE),
                      rule(this.FUNCTION),
                    ]),
                  ]),
                  ([abstract, value]) => ({
                    kind: value.kind,
                    name: value.name,
                    children: value.children,
                    modifiers: present(abstract),
                  }),
                ),
                node(
                  "ExportAssignment",
                  and([rule(this.EXPRESSION), semicolon]),
                  ([value]) => ({ operator: "default", children: [value] }),
                ),
              ]),
            ),
            (value) => ({
              kind: value.kind,
              name: value.name,
              operator: value.operator,
              children: value.children,
              modifiers: ["default", ...(value.modifiers ?? [])],
            }),
          ),
          node(
            "ExportDeclaration",
            and([
              zeroOrOne(text("type")),
              rule(this.SPECIFIERS),
              zeroOrOne(after("from", moduleName)),
              zeroOrOne(rule(this.ATTRIBUTE_CLAUSE)),
              semicolon,
            ]),
            ([type, specifiers, from, attributes]) => ({
              modifiers: present(type),
              children: [
                ...specifiers,
                ...present(from),
                ...present(attributes),
              ],
            }),
          ),
          rule(this.DECLARATION),
        ]),
      ]),
      ([, value]) => ({
        kind: value.kind,
        name: value.name,
        children: value.children,
        operator: value.operator,
        modifiers: ["export", ...(value.modifiers ?? [])],
      }),
    );
  },
  IMPORT(): Grammar<Node> {
    return located(
      and([
        text("import"),
        zeroOrOne(
          and([text("type"), not(either("from", "="))], ([value]) => value),
        ),
        or([
          node(
            "ImportEqualsDeclaration",
            and([
              id,
              text("="),
              or([
                after("require", between("(", moduleName, ")")),
                rule(this.QUALIFIED),
              ]),
              semicolon,
            ]),
            ([name, , value]) => ({ name: name.name, children: [name, value] }),
          ),
          node(
            "ImportDeclaration",
            and([
              or([
                and([moduleName], ([name]) => [name]),
                and([
                  or([
                    and(
                      [id, zeroOrOne(after(",", rule(this.SPECIFIERS)))],
                      ([name, rest]) => [name, ...(rest ?? [])],
                    ),
                    rule(this.SPECIFIERS),
                  ]),
                  text("from"),
                  moduleName,
                ], ([names, , from]) => [...names, from]),
              ]),
              zeroOrOne(rule(this.ATTRIBUTE_CLAUSE)),
              semicolon,
            ]),
            ([names, attributes]) => ({
              children: [...names, ...present(attributes)],
            }),
          ),
        ]),
      ]),
      ([, type, value]) => ({
        kind: value.kind,
        name: value.name,
        children: value.children,
        modifiers: present(type),
      }),
    );
  },
  ATTRIBUTE_CLAUSE(): Grammar<Node> {
    return and(
      [either("with", "assert"), rule(this.ATTRIBUTES)],
      ([, value]) => value,
    );
  },
  SPECIFIERS(): Grammar<Node[]> {
    return or([
      and([
        node(
          "NamespaceSpecifier",
          and([text("*"), zeroOrOne(after("as", name))]),
          ([, name]) => ({ children: present(name) }),
        ),
      ], ([value]) => [value]),
      after(
        "{",
        list(
          node(
            "ImportExportSpecifier",
            and([
              zeroOrOne(
                and(
                  [text("type"), not(either("as", ",", "}"))],
                  ([value]) => value,
                ),
              ),
              name,
              zeroOrOne(after("as", name)),
            ]),
            ([type, name, alias]) => ({
              modifiers: present(type),
              children: [name, ...present(alias)],
            }),
          ),
          "}",
        ),
      ),
    ]);
  },
  DECLARATIONS(): Grammar<Node[]> {
    return zeroOrMany(rule(this.DECLARATION));
  },
};

// createParser registers recursive rule factories. SOURCE is a lexical adapter:
// it supplies token strings plus their source metadata to the ordinary Grammar
// context. It does not implement any declaration productions.
const declarationParser = createParser([createToken(/[\s\S]+/)], {
  ...grammar,
  SOURCE(): Grammar<DeclarationFile> {
    const file = and(
      [rule(this.DECLARATIONS), consume(EOF)],
      ([children]) => children,
    );
    return (ctx) => {
      try {
        const { tokens: lexemes, comments } = lex(new SourceCursor(ctx.input));
        const context: DeclarationContext = {
          input: ctx.input,
          tokens: lexemes.slice(0, -1).map((value) => value.text),
          pos: 0,
          skipRule: null,
          lexemes,
        };
        const result = file(context);
        if (result[1] !== null) {
          throw new ParseFailure(
            token(context, result[0]).start,
            result[1].name,
          );
        }
        ctx.pos = ctx.tokens.length;
        return [{
          kind: "DeclarationFile",
          start: 0,
          end: ctx.input.length,
          source: ctx.input,
          children: result[0],
          comments,
        }, null];
      } catch (error) {
        if (!(error instanceof ParseFailure)) throw error;
        throw new Error(
          `Parse error: expected ${error.expected} at ${error.offset}`,
        );
      }
    };
  },
});
export const parseDeclarations = (input: string): DeclarationFile =>
  declarationParser("SOURCE", input);
