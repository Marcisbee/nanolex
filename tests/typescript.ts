/** Test-only declaration grammar. See typescript.md for sources and scope. */
import {
  createSourceParser,
  type SourceCursor,
  sourcePattern,
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

function jsdocLinks(text: string): JSDocLink[] {
  return [
    ...text.matchAll(
      /\{@(link|linkcode|linkplain)\s+([^\s|}]+)(?:\s*\|?\s*([^}]*))?\}/g,
    ),
  ]
    .map((match) => ({
      kind: match[1] as JSDocLink["kind"],
      target: match[2],
      label: match[3] ?? "",
      raw: match[0],
    }));
}

/** Unknown tags and all original comment text are deliberately retained. */
export function parseJSDoc(raw: string, start = 0): JSDoc {
  const text = raw.slice(3, -2).replace(/\r\n?/g, "\n")
    .split("\n").map((line) => line.replace(/^\s*\* ?/, "")).join("\n").trim();
  const tags: JSDocTag[] = [];
  const description: string[] = [];
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    // Tags may share a line. Inline {@link ...} is prose, not a block tag.
    const matches = fence
      ? []
      : [...line.matchAll(/(?:^|\s)@([\w-]+)\b[ \t]*/g)];
    const append = (value: string) => {
      if (tags.length) tags[tags.length - 1].text += `\n${value}`;
      else description.push(value);
    };
    if (!matches.length) append(line);
    else {
      const before = line.slice(0, matches[0].index).trimEnd();
      if (before) append(before);
      matches.forEach((match, i) =>
        tags.push({
          name: match[1],
          links: [],
          text: line.slice(
            match.index! + match[0].length,
            matches[i + 1]?.index ?? line.length,
          ),
        })
      );
    }
  }
  for (const tag of tags) {
    tag.text = tag.text.trim();
    tag.links = jsdocLinks(tag.text);
    let tail = tag.text;
    if (tail.startsWith("{")) {
      let depth = 0, quote = "", end = 0;
      for (; end < tail.length; end++) {
        const c = tail[end];
        if (c === "\\") {
          end++;
          continue;
        }
        if (quote) {
          if (c === quote) quote = "";
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          quote = c;
          continue;
        }
        if (c === "{") depth++;
        if (c === "}" && --depth === 0) break;
      }
      if (end < tail.length) {
        tag.type = tail.slice(1, end);
        tail = tail.slice(end + 1).trim();
      }
    }
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
  const summary = description.join("\n").trim();
  return {
    start,
    end: start + raw.length,
    raw,
    description: summary,
    links: jsdocLinks(summary),
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

class DeclarationGrammar {
  pos = 0;
  disallowConditional = false;
  constructor(readonly tokens: Lexeme[]) {}
  get token(): Lexeme {
    return this.tokens[this.pos];
  }
  at(text: string): boolean {
    return this.token.text === text;
  }
  next(text: string): boolean {
    return this.tokens[this.pos + 1]?.text === text;
  }
  take(text: string): boolean {
    if (!this.at(text)) return false;
    this.pos++;
    return true;
  }
  expect(text: string): void {
    if (!this.take(text)) this.fail(JSON.stringify(text));
  }
  fail(expected: string): never {
    throw new ParseFailure(this.token.start, expected);
  }
  node(
    kind: string,
    start: number,
    children: Node[] = [],
    fields: Partial<Node> = {},
  ): Node {
    return {
      kind,
      start: this.tokens[start].start,
      end: this.tokens[Math.max(start, this.pos - 1)].end,
      children,
      ...fields,
      ...(this.tokens[start].docs.length
        ? { docs: this.tokens[start].docs }
        : {}),
    };
  }
  name(): Node {
    const start = this.pos;
    if (!["identifier", "string", "number"].includes(this.token.kind)) {
      this.fail("name");
    }
    const name = this.token.text;
    this.pos++;
    return this.node("Name", start, [], { name });
  }
  id(): Node {
    if (this.token.kind !== "identifier") this.fail("identifier");
    return this.name();
  }
  qualified(): Node {
    const start = this.pos, parts = [this.id()];
    while (this.take(".")) parts.push(this.id());
    return this.node("QualifiedName", start, parts, {
      name: parts.map((p) => p.name).join("."),
    });
  }
  semi(): void {
    if (this.take(";")) return;
    if (this.at("}") || this.token.kind === "eof" || this.token.newline) return;
    this.fail("semicolon or line break");
  }
  list(close: string, parse: () => Node): Node[] {
    const items: Node[] = [];
    while (!this.at(close)) {
      items.push(parse());
      if (!this.take(",")) break;
    }
    this.expect(close);
    return items;
  }
  typeParameters(): Node[] {
    if (!this.take("<")) return [];
    return this.list(">", () => {
      const start = this.pos, modifiers: string[] = [];
      while (
        ["const", "in", "out"].includes(this.token.text) &&
        this.tokens[this.pos + 1]?.kind === "identifier"
      ) modifiers.push(this.tokens[this.pos++].text);
      const name = this.id(), children = [name];
      if (this.take("extends")) {
        children.push(this.node("Constraint", this.pos, [this.type()]));
      }
      if (this.take("=")) {
        children.push(this.node("DefaultType", this.pos, [this.type()]));
      }
      return this.node("TypeParameter", start, children, {
        name: name.name,
        modifiers,
      });
    });
  }
  typeArguments(): Node[] {
    if (!this.take("<")) return [];
    return this.list(">", () => this.type());
  }
  parameters(): Node[] {
    this.expect("(");
    return this.list(")", () => {
      const start = this.pos, modifiers: string[] = [];
      while (
        ["public", "private", "protected", "readonly", "override"].includes(
          this.token.text,
        ) && this.tokens[this.pos + 1]?.kind === "identifier"
      ) modifiers.push(this.tokens[this.pos++].text);
      const rest = this.take("..."),
        name = this.binding(),
        optional = this.take("?"),
        children = [name];
      if (this.take(":")) children.push(this.type());
      return this.node("Parameter", start, children, {
        name: name.name,
        optional,
        rest,
        modifiers,
      });
    });
  }
  binding(): Node {
    const start = this.pos;
    if (this.take("{")) {
      return this.node(
        "ObjectBinding",
        start,
        this.list("}", () => {
          const s = this.pos, rest = this.take("..."), name = this.name();
          return this.node(
            "BindingElement",
            s,
            this.take(":") ? [name, this.binding()] : [name],
            { rest },
          );
        }),
      );
    }
    if (this.take("[")) {
      const children: Node[] = [];
      while (!this.take("]")) {
        if (this.take(",")) {
          children.push(this.node("OmittedBinding", this.pos - 1));
          continue;
        }
        const s = this.pos, rest = this.take("...");
        children.push(
          this.node("BindingElement", s, [this.binding()], { rest }),
        );
        if (!this.take(",")) {
          this.expect("]");
          break;
        }
      }
      return this.node("ArrayBinding", start, children);
    }
    return this.id();
  }
  type(conditional = true): Node {
    const previous = this.disallowConditional;
    this.disallowConditional = !conditional;
    try {
      const start = this.pos;
      let left = this.union();
      if (conditional && !this.token.newline && this.take("extends")) {
        const constraint = this.type(false);
        this.expect("?");
        const yes = this.type();
        this.expect(":");
        left = this.node("ConditionalType", start, [
          left,
          constraint,
          yes,
          this.type(),
        ]);
      }
      return left;
    } finally {
      this.disallowConditional = previous;
    }
  }
  union(): Node {
    const start = this.pos;
    this.take("|");
    const types = [this.intersection()];
    while (this.take("|")) types.push(this.intersection());
    return types.length === 1 ? types[0] : this.node("UnionType", start, types);
  }
  intersection(): Node {
    const start = this.pos;
    this.take("&");
    const types = [this.prefixType()];
    while (this.take("&")) types.push(this.prefixType());
    return types.length === 1
      ? types[0]
      : this.node("IntersectionType", start, types);
  }
  prefixType(): Node {
    const start = this.pos;
    if (["keyof", "readonly", "unique"].includes(this.token.text)) {
      const operator = this.tokens[this.pos++].text;
      return this.node("TypeOperator", start, [this.prefixType()], {
        operator,
      });
    }
    if (this.take("infer")) {
      const children = [this.id()];
      if (this.at("extends")) {
        const checkpoint = this.pos;
        this.pos++;
        const constraint = this.type(false);
        if (this.at("?") && !this.disallowConditional) this.pos = checkpoint;
        else children.push(constraint);
      }
      return this.node("InferType", start, children);
    }
    if (this.take("asserts")) {
      const children = [this.id()];
      if (this.take("is")) children.push(this.type());
      return this.node("TypePredicate", start, children, {
        operator: "asserts",
      });
    }
    if (
      (this.at("new") && (this.next("(") || this.next("<"))) ||
      (this.at("abstract") && this.next("new"))
    ) {
      const modifiers = this.take("abstract") ? ["abstract"] : [];
      this.expect("new");
      const children = [...this.typeParameters(), ...this.parameters()];
      this.expect("=>");
      children.push(this.type());
      return this.node("ConstructorType", start, children, { modifiers });
    }
    if (this.at("<") || this.at("(")) {
      const checkpoint = this.pos;
      try {
        const children = [...this.typeParameters(), ...this.parameters()];
        this.expect("=>");
        children.push(this.type());
        return this.node("FunctionType", start, children);
      } catch (error) {
        if (!(error instanceof ParseFailure)) throw error;
        this.pos = checkpoint;
      }
    }
    let result = this.primaryType();
    while (!this.token.newline && this.take("[")) {
      if (this.take("]")) result = this.node("ArrayType", start, [result]);
      else {
        const index = this.type();
        this.expect("]");
        result = this.node("IndexedAccessType", start, [result, index]);
      }
    }
    if (!this.token.newline && this.take("is")) {
      if (result.kind === "TypeReference" && result.children.length === 1) {
        result = result.children[0];
      }
      result = this.node("TypePredicate", start, [result, this.type()], {
        operator: "is",
      });
    }
    return result;
  }
  primaryType(): Node {
    const start = this.pos;
    if (this.take("(")) {
      const type = this.type();
      this.expect(")");
      return this.node("ParenthesizedType", start, [type]);
    }
    if (this.at("{")) return this.objectType();
    if (this.take("[")) {
      return this.node(
        "TupleType",
        start,
        this.list("]", () => {
          const s = this.pos, rest = this.take("...");
          let name: Node | undefined;
          if (
            this.token.kind === "identifier" &&
            (this.next(":") ||
              (this.next("?") && this.tokens[this.pos + 2]?.text === ":"))
          ) name = this.id();
          let optional = name ? this.take("?") : false;
          if (name) this.expect(":");
          const value = this.type();
          if (!name) optional = this.take("?");
          return this.node("TupleElement", s, name ? [name, value] : [value], {
            name: name?.name,
            rest,
            optional,
          });
        }),
      );
    }
    if (this.take("typeof")) {
      if (this.at("import")) {
        const imported = this.importType();
        return this.node("ImportType", start, imported.children, {
          operator: "typeof",
        });
      }
      return this.node("TypeQuery", start, [
        this.qualified(),
        ...this.typeArguments(),
      ]);
    }
    if (this.at("import")) return this.importType();
    if (this.token.kind.startsWith("template")) return this.templateType();
    if (
      ["string", "number"].includes(this.token.kind) ||
      ["true", "false", "null"].includes(this.token.text)
    ) {
      const name = this.tokens[this.pos++].text;
      return this.node("LiteralType", start, [], { name });
    }
    if (this.take("-")) {
      if (this.token.kind !== "number") this.fail("numeric literal");
      return this.node("LiteralType", start, [], {
        name: `-${this.tokens[this.pos++].text}`,
      });
    }
    if (
      [
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
      ].includes(this.token.text) && !this.next(".")
    ) {
      return this.node("KeywordType", start, [], {
        name: this.tokens[this.pos++].text,
      });
    }
    const name = this.qualified();
    return this.node("TypeReference", start, [name, ...this.typeArguments()], {
      name: name.name,
    });
  }
  templateType(): Node {
    const start = this.pos, children: Node[] = [];
    let kind = this.token.kind;
    children.push(
      this.node("TemplateText", this.pos, [], {
        name: this.tokens[this.pos++].text,
      }),
    );
    if (kind !== "templateLiteral") {
      do {
        children.push(this.type());
        kind = this.token.kind;
        if (kind !== "templateMiddle" && kind !== "templateTail") {
          this.fail("template continuation");
        }
        children.push(
          this.node("TemplateText", this.pos, [], {
            name: this.tokens[this.pos++].text,
          }),
        );
      } while (kind !== "templateTail");
    }
    return this.node("TemplateLiteralType", start, children);
  }
  importType(): Node {
    const start = this.pos;
    this.expect("import");
    this.expect("(");
    if (this.tokens[this.pos].kind !== "string") this.fail("module string");
    const children = [this.name()];
    if (this.take(",")) children.push(this.attributesObject());
    this.expect(")");
    if (this.take(".")) children.push(this.qualified());
    children.push(...this.typeArguments());
    return this.node("ImportType", start, children);
  }
  attributesObject(): Node {
    const start = this.pos;
    this.expect("{");
    const children = this.list("}", () => {
      const s = this.pos, name = this.name();
      this.expect(":");
      const value = this.at("{") ? this.attributesObject() : this.name();
      return this.node("ImportAttribute", s, [name, value]);
    });
    return this.node("ImportAttributes", start, children);
  }
  objectType(): Node {
    const start = this.pos;
    this.expect("{");
    // Mapped types have a distinctive [name in Type] head, with optional polarity.
    const checkpoint = this.pos;
    let readonly = "";
    if (this.take("+") || this.take("-")) {
      readonly = this.tokens[this.pos - 1].text;
      this.expect("readonly");
      readonly += "readonly";
    } else if (this.take("readonly")) readonly = "readonly";
    if (
      this.at("[") && this.tokens[this.pos + 1]?.kind === "identifier" &&
      this.tokens[this.pos + 2]?.text === "in"
    ) {
      this.pos++;
      const name = this.id();
      this.expect("in");
      const children = [name, this.type()];
      if (this.take("as")) {
        children.push(this.node("NameRemapping", this.pos, [this.type()]));
      }
      this.expect("]");
      let optional = "";
      if (this.take("+") || this.take("-")) {
        optional = this.tokens[this.pos - 1].text;
        this.expect("?");
        optional += "?";
      } else if (this.take("?")) optional = "?";
      if (this.take(":")) children.push(this.type());
      this.take(";");
      this.expect("}");
      return this.node("MappedType", start, children, {
        modifiers: [readonly, optional].filter(Boolean),
      });
    }
    this.pos = checkpoint;
    const children = this.members();
    this.expect("}");
    return this.node("TypeLiteral", start, children);
  }
  members(classMember = false): Node[] {
    const children: Node[] = [];
    while (!this.at("}")) {
      if (this.token.kind === "eof") this.fail("closing brace");
      if (this.take(";")) continue;
      children.push(this.member(classMember));
      if (!this.take(",")) this.semi();
    }
    return children;
  }
  member(classMember = false): Node {
    const start = this.pos, modifiers: string[] = [];
    while (
      [
        "public",
        "private",
        "protected",
        "static",
        "abstract",
        "readonly",
        "override",
        "declare",
        "accessor",
      ].includes(this.token.text) &&
      !["(", "<", ":", "?", ";", "}", ","].includes(
        this.tokens[this.pos + 1]?.text,
      )
    ) modifiers.push(this.tokens[this.pos++].text);
    if (
      !classMember && (this.at("(") || this.at("<") ||
        (this.at("new") && (this.next("(") || this.next("<"))))
    ) {
      const construct = this.take("new"),
        children = [...this.typeParameters(), ...this.parameters()];
      if (this.take(":")) children.push(this.type());
      return this.node(
        construct ? "ConstructSignature" : "CallSignature",
        start,
        children,
        { modifiers },
      );
    }
    if (
      (this.at("get") || this.at("set")) &&
      !["(", "<", ":", "?", ";", ",", "}", "="].includes(
        this.tokens[this.pos + 1]?.text,
      )
    ) modifiers.push(this.tokens[this.pos++].text);
    let name: Node;
    if (this.take("[")) {
      if (this.token.kind === "identifier" && this.next(":")) {
        name = this.id();
        this.expect(":");
        const index = this.type();
        this.expect("]");
        this.expect(":");
        return this.node("IndexSignature", start, [name, index, this.type()], {
          modifiers,
        });
      }
      const expr = this.expression();
      this.expect("]");
      name = this.node("ComputedName", start, [expr]);
    } else if (this.take("#")) {
      name = this.id();
      name = this.node("PrivateName", start, [name], { name: `#${name.name}` });
    } else name = this.name();
    const optional = this.take("?");
    const children = [name];
    if (this.at("<") || this.at("(")) {
      children.push(...this.typeParameters(), ...this.parameters());
      if (this.take(":")) children.push(this.type());
      return this.node(
        classMember && name.name === "constructor"
          ? "Constructor"
          : modifiers.includes("get")
          ? "GetAccessor"
          : modifiers.includes("set")
          ? "SetAccessor"
          : "MethodSignature",
        start,
        children,
        { name: name.name, modifiers, optional },
      );
    }
    if (this.take(":")) children.push(this.type());
    if (this.take("=")) children.push(this.expression());
    return this.node("PropertySignature", start, children, {
      name: name.name,
      modifiers,
      optional,
    });
  }
  /** Constant expressions in enum/ambient initializers and computed names. */
  expression(min = 0, heritage = false): Node {
    const start = this.pos;
    let left: Node;
    if (["+", "-", "~", "!"].includes(this.token.text)) {
      const operator = this.tokens[this.pos++].text;
      left = this.node("UnaryExpression", start, [this.expression(12)], {
        operator,
      });
    } else if (this.take("(")) {
      left = this.expression(0, heritage);
      this.expect(")");
      left = this.node("ParenthesizedExpression", start, [left]);
    } else left = this.name();
    while (true) {
      if (heritage && this.at("<")) {
        left = this.node("ExpressionWithTypeArguments", start, [
          left,
          ...this.typeArguments(),
        ]);
        continue;
      }
      if (this.take("(")) {
        const args = this.list(")", () => this.expression());
        left = this.node("CallExpression", start, [left, ...args]);
        continue;
      }
      if (this.take(".")) {
        left = this.node("PropertyAccess", start, [left, this.id()]);
        continue;
      }
      if (this.take("[")) {
        const index = this.expression();
        this.expect("]");
        left = this.node("ElementAccess", start, [left, index]);
        continue;
      }
      let operator = this.token.text, width = 1;
      if (
        (operator === "<" || operator === ">") && this.next(operator) &&
        this.token.end === this.tokens[this.pos + 1].start
      ) {
        operator += operator;
        width = 2;
        if (operator === ">>" && this.tokens[this.pos + 2]?.text === ">") {
          operator += ">";
          width++;
        }
      }
      const prec = ({
        "||": 1,
        "??": 1,
        "&&": 2,
        "|": 3,
        "^": 4,
        "&": 5,
        "<<": 8,
        ">>": 8,
        ">>>": 8,
        "+": 9,
        "-": 9,
        "*": 10,
        "/": 10,
        "%": 10,
        "**": 11,
      } as Record<string, number>)[operator];
      if (prec === undefined || prec < min) break;
      this.pos += width;
      left = this.node("BinaryExpression", start, [
        left,
        this.expression(prec + (operator === "**" ? 0 : 1)),
      ], { operator });
    }
    return left;
  }
  declarations(close = ""): Node[] {
    const children: Node[] = [];
    while (!this.at(close)) {
      if (this.token.kind === "eof") this.fail(JSON.stringify(close));
      children.push(this.declaration());
    }
    return children;
  }
  declaration(): Node {
    const start = this.pos, modifiers: string[] = [];
    if (this.take(";")) return this.node("EmptyDeclaration", start);
    if (this.take("export")) {
      modifiers.push("export");
      if (this.take("=")) {
        const value = this.expression();
        this.semi();
        return this.node("ExportAssignment", start, [value], { operator: "=" });
      }
      if (this.take("as")) {
        this.expect("namespace");
        const name = this.id();
        this.semi();
        return this.node("NamespaceExport", start, [name], { name: name.name });
      }
      if (this.take("default")) {
        modifiers.push("default");
        if (
          !["class", "abstract", "function", "interface"].includes(
            this.token.text,
          )
        ) {
          const value = this.expression();
          this.semi();
          return this.node("ExportAssignment", start, [value], {
            operator: "default",
          });
        }
      }
      if (
        this.at("*") || this.at("{") ||
        (this.at("type") && (this.next("*") || this.next("{")))
      ) return this.moduleClause(start, true);
    }
    while (["declare", "abstract"].includes(this.token.text)) {
      modifiers.push(this.tokens[this.pos++].text);
    }
    if (this.at("const") && this.next("enum")) {
      modifiers.push(this.tokens[this.pos++].text);
    }
    if (this.take("import")) return this.moduleClause(start, false, modifiers);
    if (this.take("type")) {
      const name = this.id(), parameters = this.typeParameters();
      this.expect("=");
      const type = this.type();
      this.semi();
      return this.node("TypeAliasDeclaration", start, [
        name,
        ...parameters,
        type,
      ], { name: name.name, modifiers });
    }
    if (this.at("interface") || this.at("class")) {
      const kind = this.tokens[this.pos++].text;
      const name = this.at("{") || this.at("<") || this.at("extends") ||
          this.at("implements")
        ? undefined
        : this.id();
      if (!name && kind === "interface") this.fail("interface name");
      const children = name
        ? [name, ...this.typeParameters()]
        : this.typeParameters();
      for (const clause of ["extends", "implements"]) {
        if (this.take(clause)) {
          const s = this.pos;
          const base = () => {
            const start = this.pos;
            const expression = this.expression(0, true);
            return expression.kind === "ExpressionWithTypeArguments"
              ? expression
              : this.node("ExpressionWithTypeArguments", start, [expression]);
          };
          const bases = [base()];
          while (this.take(",")) bases.push(base());
          children.push(
            this.node("HeritageClause", s, bases, { operator: clause }),
          );
        }
      }
      this.expect("{");
      children.push(...this.members(kind === "class"));
      this.expect("}");
      return this.node(
        kind === "class" ? "ClassDeclaration" : "InterfaceDeclaration",
        start,
        children,
        { name: name?.name, modifiers },
      );
    }
    if (this.take("function")) {
      const name = this.at("(") || this.at("<") ? undefined : this.id();
      const children = [
        ...(name ? [name] : []),
        ...this.typeParameters(),
        ...this.parameters(),
      ];
      if (this.take(":")) children.push(this.type());
      this.semi();
      return this.node("FunctionDeclaration", start, children, {
        name: name?.name,
        modifiers,
      });
    }
    if (["const", "let", "var"].includes(this.token.text)) {
      const operator = this.tokens[this.pos++].text, children: Node[] = [];
      do {
        const s = this.pos, name = this.binding(), values = [name];
        if (this.take(":")) values.push(this.type());
        if (this.take("=")) values.push(this.expression());
        children.push(
          this.node("VariableDeclaration", s, values, { name: name.name }),
        );
      } while (this.take(","));
      this.semi();
      return this.node("VariableStatement", start, children, {
        operator,
        modifiers,
      });
    }
    if (this.take("enum")) {
      const name = this.id();
      this.expect("{");
      const members = this.list("}", () => {
        const s = this.pos, name = this.name();
        return this.node(
          "EnumMember",
          s,
          this.take("=") ? [name, this.expression()] : [name],
          { name: name.name },
        );
      });
      return this.node("EnumDeclaration", start, [name, ...members], {
        name: name.name,
        modifiers,
      });
    }
    if (["namespace", "module", "global"].includes(this.token.text)) {
      const keyword = this.tokens[this.pos++].text;
      const name = keyword === "global"
        ? undefined
        : this.token.kind === "string"
        ? this.name()
        : this.qualified();
      const children = name ? [name] : [];
      if (this.take("{")) {
        children.push(...this.declarations("}"));
        this.expect("}");
      } else this.semi();
      return this.node("ModuleDeclaration", start, children, {
        name: name?.name ?? "global",
        modifiers,
        operator: keyword,
      });
    }
    this.fail("declaration");
  }
  moduleClause(
    start: number,
    exported: boolean,
    modifiers: string[] = [],
  ): Node {
    const children: Node[] = [];
    if (this.at("type") && !this.next("from") && !this.next("=")) {
      this.pos++;
      modifiers.push("type");
    }
    if (!exported && this.token.kind === "string") children.push(this.name());
    else {
      if (!exported && this.token.kind === "identifier") {
        const name = this.id();
        children.push(name);
        if (this.take("=")) {
          if (this.take("require")) {
            this.expect("(");
            if (this.tokens[this.pos].kind !== "string") {
              this.fail("module string");
            }
            children.push(this.name());
            this.expect(")");
          } else children.push(this.qualified());
          this.semi();
          return this.node("ImportEqualsDeclaration", start, children, {
            name: name.name,
            modifiers,
          });
        }
        if (!this.at("from")) this.expect(",");
      }
      if (this.take("*")) {
        const s = this.pos - 1;
        children.push(
          this.node(
            "NamespaceSpecifier",
            s,
            this.take("as") ? [this.name()] : [],
          ),
        );
      } else if (this.take("{")) {
        children.push(...this.list("}", () => {
          const s = this.pos, mods: string[] = [];
          if (
            this.at("type") &&
            !["as", ",", "}"].includes(this.tokens[this.pos + 1]?.text)
          ) {
            mods.push("type");
            this.pos++;
          }
          const name = this.name(), values = [name];
          if (this.take("as")) values.push(this.name());
          return this.node("ImportExportSpecifier", s, values, {
            modifiers: mods,
          });
        }));
      }
      if (!exported || this.at("from")) {
        this.expect("from");
        if (this.tokens[this.pos].kind !== "string") this.fail("module string");
        children.push(this.name());
      }
    }
    if (this.take("with") || this.take("assert")) {
      children.push(this.attributesObject());
    }
    this.semi();
    return this.node(
      exported ? "ExportDeclaration" : "ImportDeclaration",
      start,
      children,
      { modifiers },
    );
  }
}

export const parseDeclarations = createSourceParser<DeclarationFile>(
  ({ cursor }) => {
    try {
      const { tokens, comments } = lex(cursor);
      const grammar = new DeclarationGrammar(tokens);
      const children = grammar.declarations();
      return [{
        kind: "DeclarationFile",
        start: 0,
        end: cursor.offset,
        source: cursor.input,
        children,
        comments,
      }, null];
    } catch (error) {
      if (!(error instanceof ParseFailure)) throw error;
      return [null, { offset: error.offset, expected: error.expected }];
    }
  },
);
