// deno-lint-ignore-file no-explicit-any
export type Token = {
  pattern: string | RegExp;
  name: string;
  source: string;
  test: (v: string) => boolean;
};

/**
 * Result tuple for a Grammar:
 *   Success: [value, null]
 *   Failure: [position, expectedToken]
 */
export type GrammarResult<T> = [T, null] | [number, Token];

/**
 * Grammar is a function from parsing Context to GrammarResult<T>.
 */
export type Grammar<T> = (ctx: Context) => GrammarResult<T>;

/**
 * Parsing context shared across grammar invocations.
 */
export interface Context {
  input: string;
  tokens: string[];
  pos: number;
  skipRule: Grammar<unknown> | null;
}

/** A lightweight cursor for lexer-free, character-level grammars. */
export class SourceCursor {
  readonly input: string;
  offset = 0;

  constructor(input: string) {
    this.input = input;
  }

  get eof(): boolean {
    return this.offset >= this.input.length;
  }

  get remaining(): string {
    return this.input.slice(this.offset);
  }

  peek(distance = 0): string | undefined {
    return this.input[this.offset + distance];
  }

  checkpoint(): number {
    return this.offset;
  }

  restore(checkpoint: number): void {
    if (
      !Number.isInteger(checkpoint) || checkpoint < 0 ||
      checkpoint > this.input.length
    ) {
      throw new RangeError("Invalid source checkpoint");
    }
    this.offset = checkpoint;
  }

  advance(length = 1): string {
    if (!Number.isInteger(length) || length < 0) {
      throw new RangeError(
        "Source advance length must be a non-negative integer",
      );
    }
    const start = this.offset;
    this.offset = Math.min(this.input.length, start + length);
    return this.input.slice(start, this.offset);
  }

  consume(value: string): string | null {
    if (!this.input.startsWith(value, this.offset)) return null;
    this.offset += value.length;
    return value;
  }

  match(pattern: RegExp): RegExpExecArray | null {
    const flags = pattern.flags.replace(/[gy]/g, "");
    const anchored = new RegExp(`^(?:${pattern.source})`, flags);
    const match = anchored.exec(this.remaining);
    if (match) this.offset += match[0].length;
    return match;
  }

  consumeWhile(test: (char: string, offset: number) => boolean): string {
    const start = this.offset;
    while (
      this.offset < this.input.length &&
      test(this.input[this.offset], this.offset)
    ) {
      this.offset++;
    }
    return this.input.slice(start, this.offset);
  }

  slice(start: number, end = this.offset): string {
    return this.input.slice(start, end);
  }
}

export type SourceError = {
  offset: number;
  expected: string;
};

export type SourceResult<T> = [T, null] | [null, SourceError];

export interface SourceContext<S> {
  cursor: SourceCursor;
  state: S;
}

export type SourceGrammar<T, S = undefined> = (
  context: SourceContext<S>,
) => SourceResult<T>;

/** Match a literal or dynamically computed literal at the current offset. */
export function sourceLiteral<S = undefined>(
  value: string | ((context: SourceContext<S>) => string),
  expected?: string,
): SourceGrammar<string, S> {
  return (context) => {
    const literal = typeof value === "function" ? value(context) : value;
    const offset = context.cursor.offset;
    const matched = context.cursor.consume(literal);
    return matched === null
      ? [null, { offset, expected: expected ?? JSON.stringify(literal) }]
      : [matched, null];
  };
}

/** Match an anchored regular expression without tokenizing the input. */
export function sourcePattern<S = undefined>(
  pattern: RegExp,
  expected = pattern.source,
): SourceGrammar<RegExpExecArray, S> {
  const flags = pattern.flags.replace(/[gy]/g, "");
  const anchored = new RegExp(`^(?:${pattern.source})`, flags);
  return (context) => {
    const offset = context.cursor.offset;
    const matched = anchored.exec(context.cursor.remaining);
    if (matched) context.cursor.advance(matched[0].length);
    return matched ? [matched, null] : [null, { offset, expected }];
  };
}

/**
 * Run a source grammar transactionally. Cursor and parse state are restored
 * when the grammar fails, making bounded speculative parsing explicit.
 */
export function transactional<T, S>(
  grammar: SourceGrammar<T, S>,
  cloneState: (state: S) => S = (state) => state,
): SourceGrammar<T, S> {
  return (context) => {
    const checkpoint = context.cursor.checkpoint();
    const state = cloneState(context.state);
    const result = grammar(context);
    if (result[1] !== null) {
      context.cursor.restore(checkpoint);
      context.state = state;
    }
    return result;
  };
}

/** Create a reusable lexer-free parser with isolated state for every parse. */
export function createSourceParser<T, S = undefined>(
  grammar: SourceGrammar<T, S>,
  createState: () => S = (() => undefined as S),
): (input: string) => T {
  return (input) => {
    const context: SourceContext<S> = {
      cursor: new SourceCursor(input),
      state: createState(),
    };
    const result = grammar(context);
    if (result[1] !== null) {
      throw new Error(
        `Parse error: expected ${result[1].expected} at ${result[1].offset}`,
      );
    }
    if (!context.cursor.eof) {
      throw new Error(
        `Parse error: unexpected input at ${context.cursor.offset}`,
      );
    }
    return result[0];
  };
}

/** Utility: extract the value type from a Grammar */
export type UnwrapGrammar<G> = G extends Grammar<infer V> ? V : never;

/** Utility: tuple value types -> union */
type UnionOf<R extends readonly Grammar<any>[]> = {
  [K in keyof R]: UnwrapGrammar<R[K]>;
}[number];

/** Create a token definition */
export function createToken(pattern: string | RegExp, name?: string): Token {
  const isString = typeof pattern === "string";
  const source = isString
    ? pattern.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")
    : pattern.source;

  // Precompile an anchored full-match regex for RegExp tokens
  const fullRegex = isString ? null : new RegExp(`^${source}$`);

  return {
    pattern,
    source,
    name: name || source,
    test: isString
      ? (value: string): boolean => value === pattern
      : (value: string): boolean => (fullRegex as RegExp).test(value),
  };
}

export const EOF: Token = {
  pattern: "",
  name: "EOF",
  source: "",
  test: () => false,
};

// Internal special tokens for generic errors
export const UNEXPECTED: Token = {
  pattern: "",
  name: "UNEXPECTED",
  source: "",
  test: () => false,
};

export const INFINITE_LOOP: Token = {
  pattern: "",
  name: "INFINITE_LOOP",
  source: "",
  test: () => false,
};

// Compilation metadata is private; ordinary grammars remain callable functions.
type Recipe = { kind: string; [key: string]: any };
const recipes = new WeakMap<Grammar<any>, Recipe>();
function describe<T>(recipe: Recipe, grammar: Grammar<T>): Grammar<T> {
  recipes.set(grammar, recipe);
  return grammar;
}

/** Transform a grammar value with its starting token position and context. */
export function map<T, U>(
  grammar: Grammar<T>,
  transform: (value: T, context: Context, start: number) => U,
): Grammar<U> {
  return describe({ kind: "map", grammar, transform }, (ctx) => {
    const start = ctx.pos;
    const result = grammar(ctx);
    return result[1] === null
      ? [transform(result[0], ctx, start), null]
      : result;
  });
}

/**
 * Sequence (AND) combinator.
 * When no transform is provided the resulting value is a tuple whose
 * element types correspond to each rule's produced value.
 */
export function and<R extends readonly Grammar<any>[]>(
  rules: [...R],
): Grammar<{ [K in keyof R]: UnwrapGrammar<R[K]> }>;
export function and<R extends readonly Grammar<any>[], T>(
  rules: [...R],
  transform: (values: { [K in keyof R]: UnwrapGrammar<R[K]> }) => T,
): Grammar<T>;
export function and(
  rules: readonly Grammar<any>[],
  transform?: (values: any[]) => any,
): Grammar<any> {
  return describe({ kind: "and", rules, transform }, (ctx) => {
    const startPos = ctx.pos;
    // Most alternatives fail on their first rule. Avoid allocating their
    // value array, and forward failures without allocating another tuple.
    if (rules.length === 0) return [transform ? transform([]) : [], null];
    const first = rules[0](ctx);
    if (first[1] !== null) {
      ctx.pos = startPos;
      return first;
    }
    const values: any[] = [first[0]];
    for (let i = 1; i < rules.length; i++) {
      const result = rules[i](ctx);
      if (result[1] !== null) {
        ctx.pos = startPos;
        return result;
      }
      values.push(result[0]);
    }
    return [transform ? transform(values) : values, null];
  });
}

/**
 * Consume a specific token (forward).
 */
export function consume<T>(
  token: Token,
  transform: (v: string) => T,
): Grammar<T>;
export function consume(token: Token): Grammar<string>;
export function consume(
  token: Token,
  transform?: (v: string) => unknown,
): Grammar<any> {
  return describe({ kind: "consume", token, transform }, (ctx) => {
    const chunks = ctx.tokens;
    let i = ctx.pos;
    const n = chunks.length;

    while (i < n) {
      const c = chunks[i];

      if (!c) {
        i++;
        continue;
      }

      if (token.test(c)) {
        ctx.pos = i + 1;
        return [transform ? transform(c) : c, null];
      }

      if (ctx.skipRule) {
        const saved = ctx.pos;
        const sr = ctx.skipRule;
        ctx.skipRule = null;
        const [, err] = sr(ctx);
        ctx.skipRule = sr;
        if (err === null && ctx.pos > saved) {
          i = ctx.pos;
          continue;
        }
        ctx.pos = saved;
      }

      break;
    }

    if (token === EOF && i >= n) {
      ctx.pos = i;
      return [transform ? transform("") : "", null];
    }

    return [i, token];
  });
}

/**
 * Consume the next non-empty tokenizer chunk without testing its token type.
 * Unlike consume(), raw consumption includes whitespace and other trivia.
 * This is useful for recursive grammars that preserve arbitrary source text.
 */
export function consumeAny<T>(transform: (v: string) => T): Grammar<T>;
export function consumeAny(): Grammar<string>;
export function consumeAny(
  transform?: (v: string) => unknown,
): Grammar<any> {
  return describe({ kind: "consumeAny", transform }, (ctx) => {
    const chunks = ctx.tokens;
    let i = ctx.pos;
    while (i < chunks.length && !chunks[i]) i++;
    if (i >= chunks.length) return [i, EOF];

    const value = chunks[i];
    ctx.pos = i + 1;
    return [transform ? transform(value) : value, null];
  });
}

/**
 * Consume a specific token looking behind current position (backwards).
 * On success moves one position back.
 */
export function consumeBehind<T>(
  token: Token,
  transform: (v: string) => T,
): Grammar<T>;
export function consumeBehind(token: Token): Grammar<string>;
export function consumeBehind(
  token: Token,
  transform?: (v: string) => unknown,
): Grammar<any> {
  return (ctx) => {
    let i = ctx.pos;
    const chunks = ctx.tokens;
    let c: string | undefined;

    while (i > 0) {
      c = chunks[i - 1];

      if (!c) {
        i -= 1;
        continue;
      }

      if (token !== EOF && token.test(c)) {
        ctx.pos = i - 1;
        return [transform ? transform(c) : c, null];
      }
      break;
    }

    if (token === EOF && i <= 0) {
      return [transform ? transform("") : "", null];
    }

    return [Math.max(0, i - 1), token];
  };
}

/**
 * Consume and collect raw string chunks until a sentinel token or rule
 * is reached. The sentinel token / rule is NOT consumed (lookahead).
 * - If sentinel is EOF, all remaining chunks are gathered.
 * - If sentinel is a Grammar, success when that parser matches at the
 *   current position (without consuming).
 * - If sentinel is a Token, success when that token matches; failure
 *   when EOF is reached before that token is found.
 */
export function consumeUntil<T>(
  target: Token | Grammar<any>,
  transform: (vs: string[]) => T,
): Grammar<T>;
export function consumeUntil(
  target: Token | Grammar<any>,
): Grammar<string[]>;
export function consumeUntil(
  target: Token | Grammar<any>,
  transform?: (vs: string[]) => unknown,
): Grammar<any> {
  const isGrammar = typeof target === "function";
  return (ctx) => {
    const startPos = ctx.pos;
    const chunks = ctx.tokens;
    const out: string[] = [];
    let i = ctx.pos;
    let c: string | undefined;

    while (i < chunks.length) {
      c = chunks[i];

      if (!c) {
        i += 1;
        continue;
      }

      if (!isGrammar && target === EOF) {
        out.push(c);
        i += 1;
        continue;
      }

      if (isGrammar) {
        ctx.pos = i;
        const res = (target as Grammar<any>)(ctx);
        const matched = res[1] === null;
        ctx.pos = i;
        if (matched) {
          ctx.pos = i;
          return [transform ? transform(out) : out, null];
        }
      } else {
        if ((target as Token).test(c)) {
          ctx.pos = i;
          return [transform ? transform(out) : out, null];
        }
      }

      out.push(c);
      i += 1;
      ctx.pos = i;
    }

    if (!isGrammar && target === EOF) {
      return [transform ? transform(out) : out, null];
    }

    if (!isGrammar) {
      return [ctx.pos, target as Token];
    }

    return [startPos, UNEXPECTED];
  };
}

/**
 * OR combinator.
 * Produces a union of the rule value types (or transform output).
 */
export function or<R extends readonly Grammar<any>[]>(
  rules: [...R],
): Grammar<UnionOf<R>>;
export function or<R extends readonly Grammar<any>[], T>(
  rules: [...R],
  transform: (value: UnionOf<R>) => T,
): Grammar<T>;
export function or(
  rules: readonly Grammar<any>[],
  transform?: (value: any) => any,
): Grammar<any> {
  return describe({ kind: "or", rules, transform }, (ctx) => {
    const startPos = ctx.pos;
    let lastError: [number, Token] | null = null;
    for (const rule of rules) {
      const res = rule(ctx);
      if (res[1] === null) {
        return transform ? [transform(res[0]), null] : res;
      }
      lastError = res as [number, Token];
      ctx.pos = startPos;
    }
    return lastError || [startPos, EOF];
  });
}

/**
 * Select a grammar using non-consuming lookahead. The selected grammar starts
 * at the original position and failures restore that position. The fallback is
 * used for an unmatched key, not for failure of an explicitly selected branch.
 */
export function dispatch<K extends PropertyKey, T>(
  selector: Grammar<K>,
  branches: Partial<Record<K, Grammar<T>>>,
  fallback?: Grammar<T>,
): Grammar<T> {
  return describe({ kind: "dispatch", selector, branches, fallback }, (ctx) => {
    const start = ctx.pos;
    const selected = selector(ctx);
    ctx.pos = start;
    if (selected[1] !== null) return selected;
    const branch = Object.prototype.hasOwnProperty.call(branches, selected[0])
      ? branches[selected[0]]
      : fallback;
    if (!branch) return [start, UNEXPECTED];
    const result = branch(ctx);
    if (result[1] !== null) ctx.pos = start;
    return result;
  });
}

/**
 * Parse an initial value and fold repeated suffixes into it without collecting
 * an intermediate list. A failing suffix is left unconsumed. Like zeroOrMany,
 * a successful suffix must advance the input.
 */
export function fold<T, U>(
  initial: Grammar<T>,
  suffix: Grammar<U>,
  combine: (value: T, next: U) => T,
): Grammar<T> {
  return describe({ kind: "fold", initial, suffix, combine }, (ctx) => {
    const start = ctx.pos;
    const first = initial(ctx);
    if (first[1] !== null) {
      ctx.pos = start;
      return first;
    }
    let result = first;
    while (true) {
      const position = ctx.pos;
      const next = suffix(ctx);
      if (next[1] !== null) {
        ctx.pos = position;
        return result;
      }
      if (ctx.pos === position) {
        ctx.pos = start;
        return [position, INFINITE_LOOP];
      }
      result = [combine(result[0], next[0]), null];
    }
  });
}

/**
 * zeroOrMany combinator.
 */
export function zeroOrMany<V, T>(
  rule: Grammar<V>,
  transform: (vs: V[]) => T,
  until?: Grammar<any>,
): Grammar<T>;
export function zeroOrMany<V>(
  rule: Grammar<V>,
  transform?: undefined,
  until?: Grammar<any>,
): Grammar<V[]>;
export function zeroOrMany(
  rule: Grammar<any>,
  transform?: (vs: any[]) => unknown,
  until?: Grammar<any>,
): Grammar<any> {
  return describe({ kind: "zeroOrMany", rule, transform, until }, (ctx) => {
    const values: any[] = [];
    while (true) {
      if (until) {
        const save = ctx.pos;
        const u = until(ctx);
        ctx.pos = save;
        if (u[1] === null) break;
      }
      const startPos = ctx.pos;
      const res = rule(ctx);
      if (res[1] !== null) {
        ctx.pos = startPos;
        break;
      }
      values.push(res[0]);
      if (ctx.pos === startPos) {
        return [ctx.pos, INFINITE_LOOP];
      }
    }
    return [transform ? transform(values) : values, null];
  });
}

/**
 * zeroOrMany with separator.
 */
export function zeroOrManySep<V, T>(
  rule: Grammar<V>,
  sep: Grammar<any>,
  transform: (vs: V[]) => T,
  until?: Grammar<any>,
): Grammar<T>;
export function zeroOrManySep<V>(
  rule: Grammar<V>,
  sep: Grammar<any>,
  transform?: undefined,
  until?: Grammar<any>,
): Grammar<V[]>;
export function zeroOrManySep(
  rule: Grammar<any>,
  sep: Grammar<any>,
  transform?: (vs: any[]) => unknown,
  until?: Grammar<any>,
): Grammar<any> {
  return (ctx) => {
    const values: any[] = [];
    let first = true;
    while (true) {
      if (!first && until) {
        const save = ctx.pos;
        const u = until(ctx);
        ctx.pos = save;
        if (u[1] === null) break;
      }
      const startPos = ctx.pos;
      if (!first) {
        const sepRes = sep(ctx);
        if (sepRes[1] !== null) {
          break;
        }
      }
      const res = rule(ctx);
      if (res[1] !== null) {
        if (!first) ctx.pos = startPos;
        break;
      }
      values.push(res[0]);
      first = false;
    }
    return [transform ? transform(values) : values, null];
  };
}

/**
 * oneOrMany combinator.
 */
export function oneOrMany<V, T>(
  rule: Grammar<V>,
  transform: (vs: V[]) => T,
  until?: Grammar<any>,
): Grammar<T>;
export function oneOrMany<V>(
  rule: Grammar<V>,
  transform?: undefined,
  until?: Grammar<any>,
): Grammar<V[]>;
export function oneOrMany(
  rule: Grammar<any>,
  transform?: (vs: any[]) => unknown,
  until?: Grammar<any>,
): Grammar<any> {
  return and(
    [rule, zeroOrMany(rule, undefined, until)],
    ([first, rest]) =>
      (transform ? transform([first, ...rest]) : [first, ...rest]) as any,
  );
}

/**
 * oneOrMany with separator.
 */
export function oneOrManySep<V, T>(
  rule: Grammar<V>,
  sep: Grammar<any>,
  transform: (vs: V[]) => T,
  until?: Grammar<any>,
): Grammar<T>;
export function oneOrManySep<V>(
  rule: Grammar<V>,
  sep: Grammar<any>,
  transform?: undefined,
  until?: Grammar<any>,
): Grammar<V[]>;
export function oneOrManySep(
  rule: Grammar<any>,
  sep: Grammar<any>,
  transform?: (vs: any[]) => unknown,
  until?: Grammar<any>,
): Grammar<any> {
  return and(
    [
      rule,
      zeroOrMany(
        and([sep, rule]),
        (seps) => seps.map((s) => s[1]),
        until,
      ),
    ],
    ([first, rest]) =>
      (transform ? transform([first, ...rest]) : [first, ...rest]) as any,
  );
}

/**
 * zeroOrOne combinator.
 */
export function zeroOrOne<V, T>(
  rule: Grammar<V>,
  transform: (v: V | undefined) => T,
): Grammar<T | undefined>;
export function zeroOrOne<V>(
  rule: Grammar<V>,
  transform?: undefined,
): Grammar<V | undefined>;
export function zeroOrOne(
  rule: Grammar<any>,
  transform?: (v: any) => unknown,
): Grammar<any> {
  return describe({ kind: "zeroOrOne", rule, transform }, (ctx) => {
    const startPos = ctx.pos;
    const res = rule(ctx);
    if (res[1] === null) {
      return transform ? [transform(res[0]), null] : res;
    }
    ctx.pos = startPos;
    return [undefined, null];
  });
}

/**
 * Peek (lookahead) - value is preserved, position is restored.
 */
export function peek<V>(rule: Grammar<V>): Grammar<V> {
  return describe({ kind: "peek", rule }, (ctx) => {
    const startPos = ctx.pos;
    const res = rule(ctx);
    ctx.pos = startPos;
    return res;
  });
}

/**
 * Negative lookahead. Succeeds when inner rule fails.
 * Always produces null as its value.
 */
export function not(rule: Grammar<any>): Grammar<null> {
  return describe({ kind: "not", rule }, (ctx) => {
    const startPos = ctx.pos;
    const res = rule(ctx);
    ctx.pos = startPos;
    if (res[1] === null) {
      return [startPos, UNEXPECTED];
    }
    return [null, null];
  });
}

/**
 * Apply a temporary skip rule inside another rule.
 */
export function skipIn<V>(
  skip: Grammar<any> | null,
  rule: Grammar<V>,
): Grammar<V> {
  return describe({ kind: "skipIn", skip, rule }, (ctx) => {
    const prevSkip = ctx.skipRule;
    ctx.skipRule = skip;
    const res = rule(ctx);

    // If pattern "{", SKIP, "}" is used, ensure we skip until we find "}"
    if (skip) {
      ctx.skipRule = null;
      skip(ctx);
      ctx.skipRule = skip;
    }

    ctx.skipRule = prevSkip;
    return res;
  });
}

/**
 * Wrap a raw rule accessor (for potential lazy evaluation) while preserving its exact Grammar type.
 * Using a higher-kinded generic inference based on the function's own return type
 * avoids collapsing the inner value type to 'any' when the rawRules object
 * becomes contextually typed.
 */
export function rule<V>(r: () => Grammar<V>): Grammar<V> {
  return describe(
    { kind: "rule", factory: r },
    (ctx) => (r as any).cached(ctx),
  );
}

/**
 * Produce a code lens / pointer excerpt for error reporting.
 */
function getCodeLens(chunks: string[], i: number) {
  const c = chunks[i] || "";
  const textBefore = chunks.slice(0, i + 1).join("");
  const lines = textBefore.split("\n");
  const lineBefore = lines.pop() || "";
  const lineBeforeBefore = lines.pop() || "";
  const position = textBefore.length - c.length;

  const codeLensBefore = lineBeforeBefore
    ? ` ${lines.length}| ${lineBeforeBefore}\n`
    : "";
  const codeLensTarget = ` ${lines.length + 1}| ${lineBefore}`;
  const codeLensPointer = `   ${
    new Array(
      Math.max(
        lineBefore.length - c.length + String(lines.length + 1).length,
        0,
      ),
    )
      .fill(" ")
      .join("")
  }${new Array(c.length).fill("^").join("") || "^"}`;
  const codeLens = `\n\n${codeLensBefore}${codeLensTarget}\n${codeLensPointer}`;

  return { codeLens, position };
}

/**
 * Overload 1 (broad) - keeps precise return types of each rule without prematurely widening.
 */
export function createParser<T>(
  tokens: Token[],
  rawRules: T,
  skipFactory?: () => Grammar<any>,
  options?: { compile?: boolean },
): <K extends keyof T>(
  key: K,
  input: string,
) => T[K] extends () => Grammar<infer V> ? V : never;

/**
 * Implementation signature - enforces that rawRules' properties are functions returning Grammar<any>.
 */
export function createParser<T extends Record<string, () => Grammar<any>>>(
  tokens: Token[],
  rawRules: T,
  skipFactory?: () => Grammar<any>,
  options?: { compile?: boolean },
): <K extends keyof T>(
  key: K,
  input: string,
) => UnwrapGrammar<ReturnType<T[K]>> {
  const tokenRegex = new RegExp(
    "(" + tokens.map((t) => t.source).join("|") + ")",
  );

  // Precompute & cache concrete Grammar instances on each rule function
  for (const key in rawRules) {
    (rawRules[key] as any).cached ??= rawRules[key]();
  }

  const fullRules: Partial<Record<keyof T, Grammar<any>>> = Object.create(null);
  const skipRule = skipFactory ? skipFactory() : null;

  return (key, input) => {
    const tokensArr = input.split(tokenRegex);
    const ctx: Context = {
      input,
      tokens: tokensArr,
      pos: 0,
      skipRule,
    };

    let fullRule = fullRules[key];
    if (!fullRule) {
      // Preserve the exact Grammar type of the base rule
      const base = rule(rawRules[key]) as ReturnType<T[typeof key]>;
      const complete = and([base, consume(EOF)], ([v]) => v);
      fullRule = options?.compile ? compile(complete) : complete;
      fullRules[key] = fullRule;
    }

    const res = fullRule(ctx);
    if (res[1] !== null) {
      const [pos, expectedToken] = res as [number, Token];
      const got = pos >= ctx.tokens.length
        ? EOF.name
        : JSON.stringify(ctx.tokens[pos]);
      const { codeLens, position } = getCodeLens(
        ctx.tokens,
        Math.min(pos, ctx.tokens.length - 1),
      );
      throw new Error(
        `Parse error: expected ${expectedToken.name} found ${got} at ${position}${codeLens}`,
      );
    }
    return res[0] as UnwrapGrammar<ReturnType<T[typeof key]>>;
  };
}

/**
 * Compile a registered combinator grammar once. Custom grammars and trivia
 * consumption retain their ordinary callable behavior. Compilation uses the
 * Function constructor; use the interpreter where CSP disallows dynamic code.
 * Compile after createParser has registered recursive rule factories. Treat
 * the grammar structure as fixed after compilation.
 */
export function compile<T>(grammar: Grammar<T>): Grammar<T> {
  const bindings: any[] = [];
  const functions: string[] = [];
  const ids = new Map<Grammar<any>, number>();
  let serial = 0;
  const variable = () => `v${serial++}`;
  const bind = (value: any) => {
    const i = bindings.push(value) - 1;
    return `b[${i}]`;
  };
  const callable = (fn: any) => `(0,${bind(fn)})`;
  const eof = bind(EOF),
    unexpected = bind(UNEXPECTED),
    infinite = bind(INFINITE_LOOP);
  function register(grammar: Grammar<any>): number {
    const existing = ids.get(grammar);
    if (existing !== undefined) return existing;
    const id = functions.length;
    ids.set(grammar, id);
    functions.push("");
    functions[id] = `f[${id}]=function(c,s){${
      emit(grammar, "return false;")
    }return true;};`;
    return id;
  }
  function fallback(
    grammar: Grammar<any>,
    fail: string,
    receiver?: string,
  ): string {
    const result = variable();
    const call = receiver
      ? `${bind(grammar)}.call(${receiver},c)`
      : `${callable(grammar)}(c)`;
    return `const ${result}=${call};if(${result}[1]!==null){s.p=${result}[0];s.e=${result}[1];${fail}}s.v=${result}[0];`;
  }

  function emit(
    grammar: Grammar<any>,
    fail: string,
    receiver?: string,
  ): string {
    const r = recipes.get(grammar);
    if (!r) return fallback(grammar, fail, receiver);
    if (r.kind === "rule") {
      const target = r.factory.cached;
      if (!target) {
        throw new Error(
          "Compile recursive rules after createParser registration",
        );
      }
      if (!recipes.has(target)) return fallback(target, fail, bind(r.factory));
      return `if(!f[${register(target)}](c,s)){${fail}}`;
    }
    if (r.kind === "consume" || r.kind === "consumeAny") {
      const chunk = variable(),
        token = r.kind === "consume" ? bind(r.token) : null;
      const value = r.transform ? `${callable(r.transform)}(${chunk})` : chunk;
      return `const ${chunk}=c.tokens[c.pos];if(!c.skipRule&&${chunk}){${
        token
          ? `if(!${token}.test(${chunk})){s.p=c.pos;s.e=${token};${fail}}`
          : ""
      }c.pos++;s.v=${value};}else{${fallback(grammar, fail)}}`;
    }
    if (r.kind === "map") {
      const start = variable();
      return `const ${start}=c.pos;${emit(r.grammar, fail)}s.v=${
        callable(r.transform)
      }(s.v,c,${start});`;
    }
    if (r.kind === "and") {
      const start = variable();
      let code = `const ${start}=c.pos;`;
      const values: string[] = [];
      for (const child of r.rules) {
        const value = variable();
        code += `{${
          emit(
            child,
            `c.pos=${start};${fail}`,
            recipes.has(child) ? undefined : bind(r.rules),
          )
        }var ${value}=s.v;}`;
        values.push(value);
      }
      const array = `[${values.join(",")}]`;
      return code +
        `s.v=${r.transform ? `${callable(r.transform)}(${array})` : array};`;
    }
    if (r.kind === "or") {
      const start = variable(), done = variable();
      let code = `const ${start}=c.pos;${done}:{`;
      for (const child of r.rules) {
        const alternative = variable();
        code += `${alternative}:{${
          emit(child, `c.pos=${start};break ${alternative};`)
        }${
          r.transform ? `s.v=${callable(r.transform)}(s.v);` : ""
        }break ${done};}`;
      }
      if (!r.rules.length) code += `s.p=${start};s.e=${eof};`;
      return code + fail + "}";
    }
    if (r.kind === "zeroOrOne" || r.kind === "peek" || r.kind === "not") {
      const start = variable(), done = variable();
      const onFailure = r.kind === "peek"
        ? `c.pos=${start};${fail}`
        : `c.pos=${start};s.v=${
          r.kind === "not" ? "null" : "undefined"
        };break ${done};`;
      let code = `const ${start}=c.pos;${done}:{${emit(r.rule, onFailure)}`;
      if (r.kind === "not") {
        code += `c.pos=${start};s.p=${start};s.e=${unexpected};${fail}`;
      } else if (r.kind === "peek") code += `c.pos=${start};`;
      else if (r.transform) code += `s.v=${callable(r.transform)}(s.v);`;
      return code + "}";
    }
    if (r.kind === "zeroOrMany" || r.kind === "fold") {
      const folded = r.kind === "fold",
        start = variable(),
        values = variable(),
        loop = variable(),
        pos = variable();
      let code = `const ${start}=c.pos;`;
      if (folded) code += emit(r.initial, `c.pos=${start};${fail}`);
      code += `let ${values}=${
        folded ? "s.v" : "[]"
      };${loop}:while(true){const ${pos}=c.pos;`;
      if (r.until) {
        const check = variable();
        code += `${check}:{${
          emit(r.until, `c.pos=${pos};break ${check};`)
        }c.pos=${pos};break ${loop};}`;
      }
      code += emit(folded ? r.suffix : r.rule, `c.pos=${pos};break ${loop};`);
      // Match zeroOrMany's transform/progress order; fold checks before combine.
      if (!folded) code += `${values}.push(s.v);`;
      code += `if(c.pos===${pos}){s.p=${pos};s.e=${infinite};${
        folded ? `c.pos=${start};` : ""
      }${fail}}`;
      if (folded) code += `${values}=${callable(r.combine)}(${values},s.v);`;
      code += `}s.v=${
        !folded && r.transform ? `${callable(r.transform)}(${values})` : values
      };`;
      return code;
    }
    if (r.kind === "skipIn") {
      const previous = variable(), matched = variable(), done = variable();
      const skip = bind(r.skip);
      return `const ${previous}=c.skipRule;let ${matched}=true;c.skipRule=${skip};${done}:{${
        emit(r.rule, `${matched}=false;break ${done};`)
      }}${
        r.skip ? `c.skipRule=null;(0,${skip})(c);c.skipRule=${skip};` : ""
      }c.skipRule=${previous};if(!${matched}){${fail}}`;
    }
    if (r.kind === "dispatch") {
      const start = variable(),
        index = variable(),
        branches = new Map<PropertyKey, number>();
      for (const key of Reflect.ownKeys(r.branches)) {
        branches.set(key, r.branches[key] ? register(r.branches[key]) : -1);
      }
      const missing = r.fallback ? register(r.fallback) : -1;
      return `const ${start}=c.pos;${
        emit(r.selector, `c.pos=${start};${fail}`)
      }c.pos=${start};const ${index}=${
        bind(branches)
      }.get(typeof s.v==='symbol'?s.v:String(s.v))??${missing};if(${index}<0){s.p=${start};s.e=${unexpected};${fail}}if(!f[${index}](c,s)){c.pos=${start};${fail}}`;
    }
    return fallback(grammar, fail);
  }
  const root = register(grammar);
  const factory = new Function(
    "b",
    `"use strict";const f=[];${
      functions.join("\n")
    }return function(c){const s={v:undefined,p:0,e:${eof}};return f[${root}](c,s)?[s.v,null]:[s.p,s.e];};`,
  );
  return factory(bindings) as Grammar<T>;
}
