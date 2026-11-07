/**
 * Proves the converted tables (cablesizer/lookup-tables.json, read through `lookup`) return the
 * same value as the original CableSizer rules (docs/reference/cablesizer_lookup_rules.json).
 *
 * The original `when` strings are evaluated here with an independent evaluator - this file does
 * not reuse the converter's parser - using CableSizer's first-match order.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cableSizerTables,
  lookup,
  REVIEW_STATUS,
  type CellValue,
  type LookupInput,
} from './index.js';

const sourceText = readFileSync(
  new URL('../../../../docs/reference/cablesizer_lookup_rules.json', import.meta.url),
  'utf8',
);
type SourceRule = { when: string; value: number | string; default?: boolean };
const source = JSON.parse(sourceText) as Record<string, { args: string[]; rules: SourceRule[] }>;

// ----- independent evaluator for the original expressions -----------------------------------
type Env = Record<string, number | string | null>;
type Cmp = { field: string; op: string; value: number | string };

const TOKEN = /\s*(\(|\)|==|<=|>=|<|>|"[^"]*"|-?\d+(?:\.\d+)?|[A-Za-z_]\w*)/y;
function tokens(src: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while (TOKEN.lastIndex < src.trimEnd().length && (m = TOKEN.exec(src))) out.push(m[1]!);
  return out;
}
const lit = (t: string) => (t.startsWith('"') ? t.slice(1, -1) : Number(t));

function compare(a: number | string | null, op: string, b: number | string): boolean {
  if (op === '==') return a === b;
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
}

const dnfCache = new Map<string, Cmp[][]>();
function dnf(src: string): Cmp[][] {
  let terms = dnfCache.get(src);
  if (!terms) dnfCache.set(src, (terms = parseDnf(src)));
  return terms;
}

/** Parses into disjunctive normal form: a list of AND-terms, any of which makes the rule true. */
function parseDnf(src: string): Cmp[][] {
  const tk = tokens(src);
  let i = 0;
  const or = (): Cmp[][] => {
    let terms = and();
    while (tk[i] === 'or') {
      i++;
      terms = [...terms, ...and()];
    }
    return terms;
  };
  const and = (): Cmp[][] => {
    let terms = atom();
    while (tk[i] === 'and') {
      i++;
      const right = atom();
      terms = terms.flatMap((l) => right.map((r) => [...l, ...r]));
    }
    return terms;
  };
  const atom = (): Cmp[][] => {
    const t = tk[i++]!;
    if (t === '(') {
      const inner = or();
      i++; // ')'
      return inner;
    }
    if (t === 'True') return [[]];
    const op = tk[i++]!;
    return [[{ field: t, op, value: lit(tk[i++]!) }]];
  };
  return or();
}

const holds = (src: string, env: Env) =>
  dnf(src).some((term) => term.every((c) => compare(env[c.field] ?? null, c.op, c.value)));

function firstMatch(fn: string, env: Env): { index: number; rule: SourceRule } | undefined {
  const rules = source[fn]!.rules;
  const index = rules.findIndex((r) => holds(r.when, env));
  return index < 0 ? undefined : { index, rule: rules[index]! };
}

/** An input satisfying the rule, or undefined if no AND-term is satisfiable. */
function witness(fn: string, when: string): Env | undefined {
  for (const term of dnf(when)) {
    const env: Env = Object.fromEntries(source[fn]!.args.map((a) => [a, null]));
    const byField = new Map<string, Cmp[]>();
    for (const c of term) byField.set(c.field, [...(byField.get(c.field) ?? []), c]);
    for (const [field, cs] of byField) {
      const exact = cs.find((c) => c.op === '==');
      if (exact) {
        env[field] = exact.value;
        continue;
      }
      const lows = cs.filter((c) => c.op === '>' || c.op === '>=').map((c) => c.value as number);
      const highs = cs.filter((c) => c.op === '<' || c.op === '<=').map((c) => c.value as number);
      const lo = lows.length ? Math.max(...lows) : undefined;
      const hi = highs.length ? Math.min(...highs) : undefined;
      env[field] =
        lo !== undefined && hi !== undefined
          ? (lo + hi) / 2
          : lo !== undefined
            ? cs.some((c) => c.op === '>=' && c.value === lo)
              ? lo
              : lo + 1
            : cs.some((c) => c.op === '<=' && c.value === hi)
              ? hi!
              : hi! - 1;
    }
    if (holds(when, env)) return env;
  }
  return undefined;
}

/** What the original value means, independent of the converter's code. */
function expected(fn: string, value: number | string): CellValue {
  if (typeof value === 'number') return value;
  const [a, op, b] = value.split(/\s+/);
  if (op === '*' && fn === 'CPC')
    return { kind: 'parallel', conductors: Number(a), sizeMm2: Number(b) };
  if (op === '*') return Number(a) * Number(b);
  if (op === '/') return Number(a) / Number(b);
  return { kind: 'text', text: value };
}

function converted(fn: string, env: Env) {
  const r = lookup(cableSizerTables, fn, env as LookupInput);
  return r.found ? r.value : 'NOT FOUND';
}
function original(fn: string, env: Env) {
  const m = firstMatch(fn, env);
  return m ? expected(fn, m.rule.value) : 'NOT FOUND';
}

// ----- tests ----------------------------------------------------------------------------------
describe('CableSizer conversion', () => {
  it('was generated from the current source file (re-run convert:cablesizer if this fails)', () => {
    expect(cableSizerTables.source.sha256).toBe(
      createHash('sha256').update(sourceText).digest('hex'),
    );
  });

  it('keeps every function and every rule, in order', () => {
    expect(Object.keys(cableSizerTables.functions)).toEqual(Object.keys(source));
    for (const [fn, def] of Object.entries(source)) {
      expect(cableSizerTables.functions[fn]!.rows.map((r) => r.source)).toEqual(
        def.rules.map((_, i) => i),
      );
    }
  });

  for (const [fn, def] of Object.entries(source)) {
    it(`${fn}: every original rule returns the same value from the converted table`, () => {
      const shadowed: number[] = [];
      def.rules.forEach((rule, index) => {
        const env = witness(fn, rule.when);
        expect(env, `${fn}[${index}] has no satisfiable input: ${rule.when}`).toBeDefined();
        if (firstMatch(fn, env!)?.index !== index) shadowed.push(index);
        expect(converted(fn, env!), `${fn}[${index}] ${rule.when}`).toEqual(original(fn, env!));

        // Probe each numeric boundary just below, on and just above.
        for (const term of dnf(rule.when)) {
          for (const c of term.filter((c) => typeof c.value === 'number')) {
            for (const d of [-0.5, -0.001, 0, 0.001, 0.5]) {
              const probe = { ...env!, [c.field]: (c.value as number) + d };
              expect(converted(fn, probe), `${fn}[${index}] ${c.field}=${probe[c.field]}`).toEqual(
                original(fn, probe),
              );
            }
          }
        }
      });
      // A rule hidden behind an earlier rule can never be returned - by either form.
      expect(shadowed, `${fn}: rules unreachable in first-match order`).toEqual(
        KNOWN_SHADOWED[fn] ?? [],
      );
    }, 180_000); // exhaustive: every rule x every boundary probe; slow while the whole suite runs
  }

  it('returns not found (never a silent default) where CableSizer has no row', () => {
    // V-15 (legacy): the PVC table has 90 mm2 instead of 95 mm2.
    expect(lookup(cableSizerTables, 'VU', { TYP: 'PVC', PHASES: 3, CAB: 95 })).toEqual({
      found: false,
    });
    // V-14 (legacy): final-circuit helper gap at 8 A.
    expect(lookup(cableSizerTables, 'breaker', { code: 1, Amp: 8 })).toEqual({ found: false });
  });

  it('flags known legacy errors for engineer sign-off without changing their values', () => {
    const vu = cableSizerTables.functions.VU!.rows;
    const xlpe630 = vu.find((r) => r.source === 79)!;
    expect(xlpe630.value).toBe(0.24);
    expect(xlpe630.review?.status).toBe(REVIEW_STATUS);
    expect(vu.find((r) => r.source === 42)!.review?.reference).toBe('V-15');
  });
});

/** Rules that an earlier rule always pre-empts (data issues in the source; kept as-is). */
const KNOWN_SHADOWED: Record<string, number[]> = {};
