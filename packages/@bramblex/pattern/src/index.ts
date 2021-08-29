type Matched = Record<string, unknown>;

type PatternRule = any;

interface PatternContext {
  matched: Matched;
};

interface Pattern {
  __pattern__: typeof pattern;
  (target: unknown): boolean;
}

let context: PatternContext | null = null;

export const capture = (name: string, rule: PatternRule) => {
  const p = pattern(rule);

  return pattern.create(target => {

    if (!context) {
      return p(target);
    }

    const lastMatched = context.matched;
    context.matched = {};
    const ok = p(target);
    context.matched = ok ? { ...lastMatched, ...context.matched, [name]: target } : lastMatched;
    return ok;
  });
}

export const match = (pattern: Pattern) =>
  (target: unknown) => {
    const ctx: PatternContext = { matched: {} };

    context = ctx;
    const ok = pattern(target);
    context = null;

    return {
      ...ctx,
      ok,
      then: <T>(next: (matched: Matched) => T) =>
        ok ? next(ctx.matched) : undefined,
    };
  }


export const guard = <T, R>(value: T, pairs: [PatternRule, (matched: Matched) => R]) => {
  for (const [p, func] of pairs) {
    const { ok, matched } = match(pattern(p))(value);
    if (ok) {
      return func(matched);
    }
  }
  return null;
}


export function pattern(rule: PatternRule) {
  if (typeof rule === 'function' && rule.__pattern__ === pattern) {
    return rule;
  } else if (Array.isArray(rule)) {
    return pattern.array(rule);
  } else if (typeof rule === 'object') {
    return pattern.struct(rule);
  } else {
    return pattern.equal(rule);
  }
}

// 生成 pattern 函数
pattern.create = (testFunc: (target: unknown) => boolean) => {
  if ((testFunc as Pattern).__pattern__) {
    return testFunc;
  }
  const p: Pattern = (_target) => testFunc(_target);
  p.__pattern__ = pattern;
  return p;
}

// 基本类
pattern.unit = pattern.create(() => true);
pattern.equal = (value: any) => pattern.create((target: unknown) => target === value);

pattern.string = pattern.create(target => typeof target === 'string');
pattern.function = pattern.create(target => typeof target === 'function');
pattern.number = pattern.create(target => typeof target === 'number');
pattern.boolean = pattern.create(target => typeof target === 'boolean');

// 逻辑类
pattern.options = (rules: PatternRule[]) => {
  const ps = rules.map(pattern);
  return pattern.create(target => {
    for (const p of ps) {
      if (p(target)) {
        return true;
      }
    }
    return false;
  });
};

pattern.and = (rules: PatternRule[]) => {
  const ps = rules.map(pattern);
  return pattern.create(target => {
    for (const p of ps) {
      if (!p(target)) {
        return false;
      }
    }
    return true;
  });
}

pattern.maybe = (rule: PatternRule) => pattern.options([rule, pattern.unit]);

pattern.not = (rule: PatternRule[]) => {
  const p = pattern(rule);
  return pattern.create(target => !p(target));
};

// struct
pattern.struct = (rule: PatternRule) => {
  const pairs = Object.entries(rule).map(([key, subRule]) => [key, pattern(subRule)] as const);
  return pattern.create(target => {
    if (target && typeof target === 'object') {
      for (const [key, p] of pairs) {
        if (!p((target as any)[key])) {
          return false;
        }
      }
      return true;
    } else {
      return false;
    }
  });
};

pattern.strictStruct = (rule: PatternRule) => {
  const subRules = Object
    .entries(rule)
    .reduce((p, [key, subRule]) => {
      p[key] = pattern(subRule);
      return p;
    }, {} as any);
  return pattern.create(target => {
    if (target && typeof target === 'object') {
      for (const [key, value] of Object.entries(target)) {
        const p = subRules[key];
        if (!p || !p(value)) {
          return false;
        }
      }
      return true;
    } else {
      return false;
    }
  });
};

// tuple
pattern.tuple = function tuple(rules: PatternRule[]) {
  const ps = rules.map(pattern);
  return pattern.create(target => {
    if (Array.isArray(target)) {
      for (let i = 0; i < ps.length; i++) {
        if (!ps[i](target[i])) {
          return false;
        }
      }
      return true;
    }
    return false;
  });
};

pattern.strictTuple = (rules: PatternRule[]) => {
  const ps = rules.map(pattern);
  return pattern.create(target => {
    if (Array.isArray(target)) {
      for (let i = 0; i < target.length; i++) {
        if (!ps[i] || !ps[i](target[i])) {
          return false;
        }
      }
      return true;
    }
    return false;
  });
};

// 数组类
pattern.array = (rules: PatternRule[]) => {
  const ps = rules.map(pattern);
  return pattern.create(target => {
    if (Array.isArray(target)) {
      const rs = ps.map(() => false);
      let rn: number = rs.length;
      for (const item of target) {
        for (let i = 0; i < ps.length; i++) {
          if (rs[i]) {
            continue;
          }
          if (ps[i](item)) {
            rs[i] = true;
            rn = rn + 1;
          }
          if (rn === 0) {
            return true;
          }
        }
      }
      return rn === 0;
    }
    return false;
  });
}

// 实例类
pattern.instance = (_class: { new(): any }, rule: PatternRule = pattern.unit) =>
  pattern.and([pattern.create(target => target instanceof _class), pattern(rule)]);

// 其他基本类型
pattern.regex = (regex: RegExp) => {
  return pattern.and([pattern.string, pattern.create(target => regex.test(target as string))]);
};