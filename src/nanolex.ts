// deno-lint-ignore-file ban-unused-ignore no-explicit-any ban-types
type ErrorToken = {
  value?: string;
  got?: string;
  token?: TokenLike;
  i: number;
};

type ComposedTokens = {
  id: number;
  tokensParse: RegExp;
};

export const EOF = Symbol("EOF") as any as TokenLike;

export function createToken(
  token: RegExp | string,
  name: string = typeof token === "string" ? token : token.source,
): TokenLike {
  const isString = typeof token === "string";
  const source = isString
    ? token.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")
    : token.source;
  const cache = new Map<string, boolean>();

  return {
    token,
    name,
    source,
    test(value: string): boolean {
      if (isString) {
        return value === token;
      }

      // return value.match(token)?.[0] === value;

      let v: boolean;
      return cache.has(value)
        ? cache.get(value)!
        : ((v = value.match(token)?.[0] === value), cache.set(value, v), v);

      // const regex = new RegExp(`^${this.source}\$`);
      // return regex.test(value);
    },
  };
}

export interface Nanolex {
  consume: <Return = string>(
    token: TokenLike,
    transform?: ((value: string) => Return) | undefined,
  ) => GrammarLike<(Return extends any ? string : Return) | undefined>;
  consumeBehind: <Return = string>(
    token: TokenLike,
    transform?: ((value: string) => Return) | undefined,
  ) => GrammarLike<(Return extends any ? string : Return) | undefined>;
  consumeUntil: (token: TokenLike) => GrammarLike<any[]>;
  peek: (rule: GrammarLike) => GrammarLike;
  oneOrMany: (
    rule: GrammarLike,
    transformer?: ((value: any) => any) | undefined,
    until?: GrammarLike,
  ) => GrammarLike<any>;
  zeroOrMany: (
    rule: GrammarLike,
    transformer?: ((value: any) => any) | undefined,
    until?: GrammarLike,
  ) => GrammarLike<any>;
  oneOrManySep: (
    rule: GrammarLike,
    sep: GrammarLike,
    transformer?: ((value: any) => any) | undefined,
    until?: GrammarLike,
  ) => GrammarLike<any>;
  zeroOrManySep: (
    rule: GrammarLike,
    sep: GrammarLike,
    transformer?: ((value: any) => any) | undefined,
    until?: GrammarLike,
  ) => GrammarLike<any>;
  zeroOrOne: <T extends GrammarLike<any>>(rule: T) => GrammarLike;
  not: (rule: GrammarLike) => GrammarLike;
  and: <T extends GrammarLike<any>[]>(
    rules: T,
    transform?: ((value: any) => any) | undefined,
  ) => GrammarLike;
  or: <T extends GrammarLike<any>[]>(
    rules: T,
    transform?: ((value: any) => any) | undefined,
  ) => GrammarLike;
  breakLoop: <T extends Function>(type: number, fn: T) => T;
  patternToSkip: (tokens: GrammarLike) => void;
  throwIfError: <T extends GrammarLike<any>>(rule: T) => any;
  createError: (value: string) => void;
}

const chunksCache: Record<string, string[]> = {};
export function nanolex(
  value: string,
  { id, tokensParse }: ComposedTokens,
): Nanolex {
  let skipCheck = false;
  let tokensSkip: Function = () => void 0;
  const loopIndexMap: Record<number, number> = {};
  const chunks = (chunksCache[value + id] ??= value.split(tokensParse));
  // chunks ??= value.split(tokensParse);
  // const chunks = value.split(tokensParse);
  const chunksLength = chunks.length;
  // const chunksEndIndex = chunksLength - 1;
  let i = 0;
  let deepestError: ErrorToken | undefined;
  let innerError: ErrorToken | undefined;
  // let consumeTimes = 0;

  // console.log({ chunks});

  return {
    consume,
    consumeBehind,
    consumeUntil,
    peek,
    oneOrMany: (rule, transformer, until) => many(rule, 1, transformer, until),
    zeroOrMany: (rule, transformer, until) => many(rule, 0, transformer, until),
    oneOrManySep: (
      rule,
      sep,
      transformer,
      until,
    ) => manySep(rule, sep, 1, transformer, until),
    zeroOrManySep: (
      rule,
      sep,
      transformer,
      until,
    ) => manySep(rule, sep, 0, transformer, until),
    zeroOrOne,
    not,
    and,
    or,
    breakLoop,
    patternToSkip,
    throwIfError,
    createError,
  };

  function patternToSkip(tokens: GrammarLike) {
    tokensSkip = () => {
      skipCheck = true;
      const result = tokens();
      skipCheck = false;

      return result;
    };
  }

  function saveError(error?: ErrorToken) {
    innerError = error;

    if (!error) {
      deepestError = undefined;
      return;
    }

    if (error.i >= (deepestError?.i || -1)) {
      deepestError = error;
    }

    return deepestError;
  }

  function createError(value: string) {
    saveError({
      value,
      i,
    });
  }

  function many(
    rule: GrammarLike,
    atLest: number,
    transform?: (value: any) => any,
    until?: GrammarLike,
  ): GrammarLike {
    return (): any => {
      const output = [];

      while (i < chunksLength) {
        innerError = undefined;
        const tempI = i;
        const resultRule = rule();

        if (innerError) {
          i = tempI;

          if (output.length < atLest) {
            break;
          }

          innerError = undefined;
          break;
        }

        output.push(resultRule);

        if (until && checkUntil(until)) {
          break;
        }
      }

      if (innerError === undefined && transform) {
        return transform(output);
      }

      return output;
    };
  }
  function manySep(
    rule: GrammarLike,
    sep: GrammarLike,
    atLest: number,
    transform?: (value: any) => any,
    until?: GrammarLike,
  ): GrammarLike {
    return (): any => {
      let tempI = i;
      const output = [];

      while (i < chunksLength) {
        // if (lastI === i) {
        // 	saveError(deepestError || innerError);
        // 	break;
        // }

        innerError = undefined;
        const resultRule = rule();

        // lastI = i;

        if (innerError) {
          i = tempI;

          if (output.length < atLest) {
            break;
          }

          innerError = undefined;
          break;
        }

        tempI = i;
        output.push(resultRule);

        innerError = undefined;
        sep();

        if (innerError) {
          innerError = undefined;
          i = tempI;
          break;
        }

        if (until && checkUntil(until)) {
          break;
        }
      }

      if (innerError === undefined && transform) {
        return transform(output);
      }

      return output;
    };
  }
  function peek(rule: GrammarLike): GrammarLike {
    return (): any => {
      const tempI = i;

      const tempError = deepestError;
      // innerError = undefined;
      const resultRule = rule();

      i = tempI;
      deepestError = tempError;

      return resultRule;
    };
  }
  function not(rule: GrammarLike): GrammarLike {
    return (): any => {
      // const tempI = i;

      const newInnerError = innerError || deepestError;
      // innerError = undefined;
      const resultRule = rule();

      if (innerError) {
        innerError = undefined;
        return;
      }

      innerError = newInnerError;

      return resultRule;
    };
  }
  function and<T extends GrammarLike[]>(
    rules: T,
    transform?: (value: any) => any,
  ): GrammarLike {
    return (): any => {
      const output = [];
      const tempI = i;

      for (const rule of rules) {
        innerError = undefined;
        const resultRule = rule();

        if (innerError) {
          i = tempI;
          break;
        }

        output.push(resultRule);
      }

      if (innerError === undefined && transform) {
        return transform(output);
      }

      return output;
    };
  }
  function or<T extends GrammarLike[]>(
    rules: T,
    transform?: (value: any) => any,
  ): GrammarLike {
    return (): any => {
      const tempI = i;

      for (const rule of rules) {
        i = tempI;
        innerError = undefined;
        const resultRule = rule();

        if (innerError) {
          continue;
        }

        if (innerError === undefined && transform) {
          return transform(resultRule);
        }

        return resultRule;
      }

      i = tempI;

      return;
    };
  }
  function zeroOrOne<T extends GrammarLike>(
    rule: T,
    transform?: (value?: any) => any,
  ): GrammarLike {
    return (): any => {
      const tempI = i;
      innerError = undefined;
      const resultRule = rule();

      if (innerError) {
        i = tempI;
        innerError = undefined;

        if (transform) {
          return transform();
        }

        return;
      }

      if (transform) {
        return transform(resultRule);
      }

      return resultRule;
    };
  }
  // @TODO: handle consumeUntil(and(...))
  function consumeUntil<Return = string[]>(
    token: TokenLike,
    transform?: (value: string[]) => Return,
  ): GrammarLike<any[]> {
    return (): any => {
      // consumeTimes += 1;
      let c: string;
      const output: string[] = [];

      while (((c = chunks[i]), i < chunksLength)) {
        if (!c) {
          i += 1;
          continue;
        }

        if (token === EOF || !token.test(c)) {
          i += 1;

          output.push(c);
          continue;
        }

        if (transform) {
          return transform(output);
        }

        return output;
      }

      if (EOF) {
        if (transform) {
          return transform(output);
        }

        return output;
      }

      saveError({
        got: c,
        token,
        i,
      });
      return;
    };
  }
  function consume<Return = string>(
    token: TokenLike,
    transform?: (value: string) => Return,
  ): GrammarLike<(Return extends any ? string : Return) | undefined> {
    return (): any => {
      // consumeTimes += 1;
      let c: string;

      while (((c = chunks[i]), i < chunksLength)) {
        if (!c) {
          i += 1;
          continue;
        }

        if (token !== EOF && token.test(c)) {
          i += 1;

          if (transform) {
            return transform(c);
          }

          return c;
        }

        const currI = i;
        if (!skipCheck && tokensSkip() !== undefined) {
          continue;
        }
        i = currI;

        break;
      }

      if (token === EOF && i >= chunksLength) {
        return;
      }

      if (c == null) {
        saveError({
          got: c,
          token,
          i: i - 1,
        });
        return;
      }

      saveError({
        got: c,
        token,
        i: i,
      });
      return;
    };
  }
  function consumeBehind<Return = string>(
    token: TokenLike,
    transform?: (value: string) => Return,
  ): GrammarLike<(Return extends any ? string : Return) | undefined> {
    return (): any => {
      let c: string;

      while (((c = chunks[i - 1]), i > 0)) {
        if (!c) {
          i -= 1;
          continue;
        }

        if (token !== EOF && token.test(c)) {
          i -= 1;

          if (transform) {
            return transform(c);
          }

          return c;
        }

        // We do not perform skip checks in reverse
        break;
      }

      if (token === EOF && i <= 0) {
        return;
      }

      if (c == null) {
        saveError({
          got: c,
          token,
          i: i,
        });
        return;
      }

      saveError({
        got: c,
        token,
        i: i - 1,
      });
      return;
    };
  }
  function throwIfError<T extends GrammarLike>(rule: T): any {
    const output = rule();

    // console.log({ consumeTimes });

    if (i !== chunksLength && deepestError) {
      const i = deepestError.value ? deepestError.i - 1 : deepestError.i;

      const [codeLens, position] = getCodeLens(chunks, i);
      const deepestErrorMessage = deepestError.value ||
        `expecting "${deepestError.token?.name ?? "EOF"}", got "${
          deepestError.got ?? "EOF"
        }"`;

      throw new Error(`${deepestErrorMessage} at ${position}${codeLens}`);
    }

    return output;
  }
  function breakLoop<T extends Function>(type: number, fn: T): T {
    if (loopIndexMap[type] === i) {
      // Break out of loop
      return (() => {
        saveError(deepestError);
        loopIndexMap[type] = undefined as any;
      }) as any;
    }

    loopIndexMap[type] = i;

    return fn;
  }

  // Utils
  function checkUntil(until: GrammarLike) {
    const tempI = i;
    innerError = undefined;
    until();
    i = tempI;

    if (!innerError) {
      return true;
    }

    innerError = undefined;

    return false;
  }
}

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

  return [codeLens, position];
}

// This is intentionally invalid type, to throw ts errors if invalid grammar is provided
interface GrammarLikeResponse<T = any> {
  response: T;
}

interface GrammarLike<T = any> {
  (): GrammarLikeResponse<T>;
  set?: GrammarLike<T>;
}

interface TokenLike {
  token: string | RegExp;
  name: string;
  source: string;
  test: (value: string) => boolean;
}

let composedTokenId = 0;
export function getComposedTokens(tokens: TokenLike[]): ComposedTokens {
  return {
    id: composedTokenId++,
    tokensParse: new RegExp("(" + tokens.map((t) => t.source).join("|") + ")"),
  };
}

export function createPattern<T = any>(name: string) {
  let pattern: any = () => {
    throw new Error(`Pattern ${name} not defined`);
  };
  const out: GrammarLike<T | undefined> = () => pattern();

  Object.defineProperty(out, "name", {
    value: name,
  });
  Object.defineProperty(out, "set", {
    configurable: true,
    enumerable: true,
    set(v: any) {
      pattern = v;
    },
  });

  return out;
}
