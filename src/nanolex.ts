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
interface Context {
  input: string;
  tokens: string[];
  pos: number;
  skipRule: Grammar<unknown> | null;
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

  const cache: Record<string, boolean> = {};
  return {
    pattern,
    source,
    name: name || source,
    test: isString
      ? (value: string): boolean => value === pattern
      : (value: string): boolean => {
        return cache[value] ??= (fullRegex as RegExp).test(value);
      },
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
  return (ctx) => {
    const startPos = ctx.pos;
    const values: any[] = [];
    for (const rule of rules) {
      const [vOrPos, tokenOrNull] = rule(ctx);
      if (tokenOrNull !== null) {
        ctx.pos = startPos;
        return [vOrPos as number, tokenOrNull];
      }
      values.push(vOrPos);
    }
    return [transform ? transform(values) : values, null];
  };
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
  return (ctx) => {
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
  };
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
        const savePos = ctx.pos;
        const res = (target as Grammar<any>)(ctx);
        const matched = res[1] === null;
        ctx.pos = savePos;
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
  return (ctx) => {
    const startPos = ctx.pos;
    let lastError: [number, Token] | null = null;
    for (const rule of rules) {
      const res = rule(ctx);
      if (res[1] === null) {
        return [transform ? transform(res[0]) : res[0], null];
      }
      lastError = res as [number, Token];
      ctx.pos = startPos;
    }
    return lastError || [startPos, EOF];
  };
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
  return (ctx) => {
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
  };
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
  return (ctx) => {
    const startPos = ctx.pos;
    const res = rule(ctx);
    if (res[1] === null) {
      return [transform ? transform(res[0]) : res[0], null];
    }
    ctx.pos = startPos;
    return [undefined, null];
  };
}

/**
 * Peek (lookahead) - value is preserved, position is restored.
 */
export function peek<V>(rule: Grammar<V>): Grammar<V> {
  return (ctx) => {
    const startPos = ctx.pos;
    const res = rule(ctx);
    ctx.pos = startPos;
    return res;
  };
}

/**
 * Negative lookahead. Succeeds when inner rule fails.
 * Always produces null as its value.
 */
export function not(rule: Grammar<any>): Grammar<null> {
  return (ctx) => {
    const res = rule(ctx);
    if (res[1] === null) {
      return [ctx.pos, UNEXPECTED];
    }
    return [null, null];
  };
}

/**
 * Apply a temporary skip rule inside another rule.
 */
export function skipIn<V>(
  skip: Grammar<any> | null,
  rule: Grammar<V>,
): Grammar<V> {
  return (ctx) => {
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
  };
}

/**
 * Wrap a raw rule accessor (for potential lazy evaluation) while preserving its exact Grammar type.
 * Using a higher-kinded generic inference based on the function's own return type
 * avoids collapsing the inner value type to 'any' when the rawRules object
 * becomes contextually typed.
 */
export function rule<V>(r: () => Grammar<V>): Grammar<V> {
  return (ctx) => (r as any).cached(ctx);
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

  const cache: Record<string, string[]> = {};
  const fullRules: Partial<Record<keyof T, Grammar<any>>> = {};
  const skipRule = skipFactory ? skipFactory() : null;

  return (key, input) => {
    const tokensArr = (cache[input] ??= input.split(tokenRegex));
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
      fullRule = and([base, consume(EOF)], ([v]) => v);
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
