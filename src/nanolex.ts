export type Token = {
  pattern: string | RegExp;
  name: string;
  source: string;
  test: (v: string) => boolean;
};

/**
 * Grammar result union:
 * Success: [value, null]
 * Failure: [position, expectedToken]
 */
export type GrammarResult = [any, null] | [number, Token];

type Grammar = (ctx: Context) => GrammarResult;

interface Context {
  input: string;
  tokens: string[];
  pos: number;
  skipRule: Grammar | null;
}

/** Create a token definition */
export function createToken(pattern: string | RegExp, name?: string): Token {
  const isString = typeof pattern === "string";
  const source = isString
    ? pattern.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")
    : pattern.source;

  // Precompile an anchored full-match regex for RegExp tokens
  const fullRegex = isString ? null : new RegExp(`^${source}$`);

  const cache = new Map<string, boolean>();
  return {
    pattern,
    source,
    name: name || source,
    test(value: string): boolean {
      if (isString) {
        return value === pattern;
      }
      let v: boolean;
      return cache.has(value)
        ? cache.get(value)!
        : ((v = (fullRegex as RegExp).test(value)), cache.set(value, v), v);
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

/** Sequence (AND) combinator */
export const and =
  (rules: Grammar[], transform?: (vs: any[]) => any): Grammar => (ctx) => {
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

/** Consume a specific token (forward) */
export const consume =
  (token: Token, transform?: (v: string) => any): Grammar => (ctx) => {
    let i = ctx.pos;
    const chunks = ctx.tokens;
    const chunksLength = chunks.length;
    let c: string | undefined;

    while (i < chunksLength) {
      c = chunks[i];

      if (!c) {
        i += 1;
        continue;
      }

      if (token !== EOF && token.test(c)) {
        i += 1;
        ctx.pos = i;
        return [transform ? transform(c) : c, null];
      }

      const currI = i;
      if (ctx.skipRule) {
        // Temporarily disable skipRule reentrancy while running it
        const startPos = ctx.pos;
        const skipRule = ctx.skipRule;
        ctx.skipRule = null;
        const [_, skipErrToken] = skipRule(ctx);
        ctx.skipRule = skipRule;
        // If skip succeeded and consumed something, continue scanning
        if (skipErrToken === null && ctx.pos > startPos) {
          i = ctx.pos;
          continue;
        }
        ctx.pos = currI;
      }
      break;
    }

    if (token === EOF && i >= chunksLength) {
      ctx.pos = i;
      return [transform ? transform("") : "", null];
    }

    return [i, token];
  };

/**
 * Consume a specific token looking behind current position (backwards).
 * If token matches the previous non-empty chunk, position is moved one
 * step back; otherwise failure is reported.
 */
export const consumeBehind =
  (token: Token, transform?: (v: string) => any): Grammar => (ctx) => {
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

/**
 * Consume and collect raw string chunks until a sentinel token or rule
 * is reached. The sentinel token / rule is NOT consumed (lookahead).
 * - If sentinel is EOF, all remaining chunks are gathered.
 * - If sentinel is a Grammar, success when that parser matches at the
 *   current position (without consuming).
 * - If sentinel is a Token, success when that token matches; failure
 *   when EOF is reached before that token is found.
 */
export const consumeUntil = (
  target: Token | Grammar,
  transform?: (vs: string[]) => any,
): Grammar => {
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

      // EOF sentinel: gather all
      if (!isGrammar && target === EOF) {
        out.push(c);
        i += 1;
        continue;
      }

      if (isGrammar) {
        const savePos = ctx.pos;
        const res = (target as Grammar)(ctx);
        const matched = res[1] === null;
        ctx.pos = savePos; // restore (lookahead)
        if (matched) {
          ctx.pos = i;
          return [transform ? transform(out) : out, null];
        }
      } else {
        // Token sentinel
        if ((target as Token).test(c)) {
          ctx.pos = i;
          return [transform ? transform(out) : out, null];
        }
      }

      // Consume this chunk
      out.push(c);
      i += 1;
      ctx.pos = i;
    }

    // If EOF sentinel, success
    if (!isGrammar && target === EOF) {
      return [transform ? transform(out) : out, null];
    }

    // Failed to find token sentinel
    if (!isGrammar) {
      return [ctx.pos, target as Token];
    }

    // Grammar sentinel not found - generic failure
    return [startPos, UNEXPECTED];
  };
};

/** OR combinator */
export const or =
  (rules: Grammar[], transform?: (v: any) => any): Grammar => (ctx) => {
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

/** zeroOrMany combinator */
export const zeroOrMany = (
  rule: Grammar,
  transform?: (vs: any[]) => any,
  until?: Grammar,
): Grammar =>
(ctx) => {
  const values: any[] = [];
  while (true) {
    // Early stop before attempting next element
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

/** zeroOrMany with separator */
export const zeroOrManySep = (
  rule: Grammar,
  sep: Grammar,
  transform?: (vs: any[]) => any,
  until?: Grammar,
): Grammar =>
(ctx) => {
  const values: any[] = [];
  let first = true;
  while (true) {
    // Early stop check
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

/** oneOrMany */
export const oneOrMany = (
  rule: Grammar,
  transform?: (vs: any[]) => any,
  until?: Grammar,
): Grammar =>
  and(
    [rule, zeroOrMany(rule, undefined, until)],
    ([first, rest]) =>
      transform ? transform([first, ...rest]) : [first, ...rest],
  );

/** oneOrMany with separator */
export const oneOrManySep = (
  rule: Grammar,
  sep: Grammar,
  transform?: (vs: any[]) => any,
  until?: Grammar,
): Grammar =>
  and(
    [
      rule,
      zeroOrMany(
        and([sep, rule]),
        (seps) => seps.map((s) => s[1]),
        until,
      ),
    ],
    ([first, rest]) =>
      transform ? transform([first, ...rest]) : [first, ...rest],
  );

/** zeroOrOne */
export const zeroOrOne =
  (rule: Grammar, transform?: (v: any) => any): Grammar => (ctx) => {
    const startPos = ctx.pos;
    const res = rule(ctx);
    if (res[1] === null) {
      return [transform ? transform(res[0]) : res[0], null];
    }
    ctx.pos = startPos;
    return [transform ? transform(undefined) : undefined, null];
  };

/** Peek (lookahead) */
export const peek = (rule: Grammar): Grammar => (ctx) => {
  const startPos = ctx.pos;
  const res = rule(ctx);
  ctx.pos = startPos;
  return res;
};

/** Negative lookahead */
export const not = (rule: Grammar): Grammar => (ctx) => {
  const res = peek(rule)(ctx);
  if (res[1] === null) {
    return [ctx.pos, UNEXPECTED];
  }
  return [null, null];
};

/** Apply a temporary skip rule inside another rule */
export const skipIn =
  (skip: Grammar | null, rule: Grammar): Grammar => (ctx) => {
    const originalSkip = ctx.skipRule;
    ctx.skipRule = skip;
    const result = rule(ctx);
    ctx.skipRule = originalSkip;
    return result;
  };

/** Wrap a raw rule accessor (for potential lazy evaluation) */
export const rule = (r: () => Grammar): Grammar => {
  return (ctx) => (r as any).cached(ctx);
};

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
 * Create a parser instance.
 * Returned function: (ruleName, input) => parsedValue | throws on error
 *
 * Optionally pass a skip pattern factory as third argument.
 */
export function createParser<T extends Record<string, () => Grammar>>(
  tokens: Token[],
  rawRules: T,
  skipFactory?: () => Grammar,
) {
  const tokenRegex = new RegExp(
    "(" + tokens.map((t) => t.source).join("|") + ")",
  );

  // Materialize rule implementations once (store under .cached)
  for (const key in rawRules) {
    (rawRules[key] as any).cached = rawRules[key]();
  }

  const cache: Record<string, string[]> = {};
  let fullRule!: Grammar;
  const skipRule = skipFactory ? skipFactory() : null;

  return (key: keyof T, input: string) => {
    const tokensArr = (cache[input] ??= input.split(tokenRegex));
    const ctx: Context = {
      input,
      tokens: tokensArr,
      pos: 0,
      skipRule,
    };
    fullRule ??= and(
      [rule(rawRules[key]), consume(EOF)],
      ([v]) => v,
    );
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
    return res[0];
  };
}
