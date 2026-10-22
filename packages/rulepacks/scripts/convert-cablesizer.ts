/**
 * One-time conversion of the CableSizer lookup rules into typed tables.
 *
 *   npm run convert:cablesizer -w @neuromep/rulepacks
 *
 * Reads  docs/reference/cablesizer_lookup_rules.json  (source record - never modified)
 * Writes packages/rulepacks/cablesizer/lookup-tables.json
 *
 * Each source rule `{ when: "<expression>", value }` becomes a row whose conditions are keyed by
 * field name, so nothing is evaluated from strings at runtime. Expressions that do not fit the
 * row shape stop the conversion with an error rather than being approximated.
 * Rows that match a design doc Appendix E issue are flagged for engineer sign-off (OI-07); their
 * values are NOT corrected here.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LookupTablesSchema,
  REVIEW_STATUS,
  type Alternative,
  type CellValue,
  type FunctionTable,
  type ReviewFlag,
  type Row,
} from '../src/cablesizer/schema.js';

const SOURCE_PATH = 'docs/reference/cablesizer_lookup_rules.json';
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUTPUT = fileURLToPath(new URL('../cablesizer/lookup-tables.json', import.meta.url));

type SourceRule = { when: string; value: number | string; default?: boolean };
type SourceFile = Record<string, { args: string[]; rules: SourceRule[] }>;

// ---------------------------------------------------------------------------------------------
// Expression parsing:  expr := and ('or' and)* ;  and := atom ('and' atom)* ;
//                      atom := '(' expr ')' | 'True' | IDENT OP literal
// ---------------------------------------------------------------------------------------------
type Literal = number | string;
type Op = '==' | '<' | '>' | '<=' | '>=';
type Node =
  | { t: 'true' }
  | { t: 'cmp'; field: string; op: Op; value: Literal }
  | { t: 'and' | 'or'; parts: Node[] };

function tokenize(src: string): string[] {
  const re = /\s*(\(|\)|==|<=|>=|<|>|"[^"]*"|-?\d+(?:\.\d+)?|[A-Za-z_]\w*)/y;
  const tokens: string[] = [];
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`Cannot tokenize at ${pos}: ${src}`);
    tokens.push(m[1]!);
    pos = re.lastIndex;
  }
  return tokens;
}

function parse(src: string): Node {
  const tk = tokenize(src);
  let i = 0;
  const peek = () => tk[i];
  const next = () => {
    const t = tk[i++];
    if (t === undefined) throw new Error(`Unexpected end: ${src}`);
    return t;
  };
  const literal = (t: string): Literal => (t.startsWith('"') ? t.slice(1, -1) : Number(t));

  function expr(): Node {
    const parts = [and()];
    while (peek() === 'or') {
      next();
      parts.push(and());
    }
    return parts.length === 1 ? parts[0]! : { t: 'or', parts };
  }
  function and(): Node {
    const parts = [atom()];
    while (peek() === 'and') {
      next();
      parts.push(atom());
    }
    return parts.length === 1 ? parts[0]! : { t: 'and', parts };
  }
  function atom(): Node {
    const t = next();
    if (t === '(') {
      const n = expr();
      if (next() !== ')') throw new Error(`Expected ")": ${src}`);
      return n;
    }
    if (t === 'True') return { t: 'true' };
    if (!/^[A-Za-z_]\w*$/.test(t)) throw new Error(`Expected field name, got "${t}": ${src}`);
    const op = next();
    if (!['==', '<', '>', '<=', '>='].includes(op)) throw new Error(`Bad operator "${op}": ${src}`);
    return { t: 'cmp', field: t, op: op as Op, value: literal(next()) };
  }

  const n = expr();
  if (i !== tk.length) throw new Error(`Trailing tokens: ${src}`);
  return n;
}

// ---------------------------------------------------------------------------------------------
// Normalisation to { field: Alternative[] }
// ---------------------------------------------------------------------------------------------
type Match = Record<string, Alternative[]>;

function cmpToAlternative(n: Extract<Node, { t: 'cmp' }>): Alternative {
  if (n.op === '==') return { eq: n.value };
  if (typeof n.value !== 'number') throw new Error(`Range on text value: ${JSON.stringify(n)}`);
  const key = ({ '<': 'lt', '>': 'gt', '<=': 'lte', '>=': 'gte' } as const)[n.op];
  return { [key]: n.value };
}

/** Intersects two alternatives on the same field (AND). */
function intersect(a: Alternative, b: Alternative, where: string): Alternative {
  const out: Alternative = { ...a };
  for (const [k, v] of Object.entries(b) as [keyof Alternative, Literal][]) {
    if (out[k] !== undefined && out[k] !== v) throw new Error(`Conflicting "${k}" in ${where}`);
    (out as Record<string, Literal>)[k] = v;
  }
  return out;
}

/** A node that constrains one field only: returns that field and its alternatives (OR). */
function singleField(n: Node, where: string): { field: string; alts: Alternative[] } {
  if (n.t === 'cmp') return { field: n.field, alts: [cmpToAlternative(n)] };
  if (n.t === 'or') {
    const parts = n.parts.map((p) => singleField(p, where));
    const field = parts[0]!.field;
    if (parts.some((p) => p.field !== field)) throw new Error(`"or" across fields in ${where}`);
    return { field, alts: parts.flatMap((p) => p.alts) };
  }
  if (n.t === 'and') {
    const parts = n.parts.map((p) => singleField(p, where));
    const field = parts[0]!.field;
    if (parts.some((p) => p.field !== field || p.alts.length !== 1)) {
      throw new Error(`Unsupported "and" inside "or" in ${where}`);
    }
    return { field, alts: [parts.map((p) => p.alts[0]!).reduce((x, y) => intersect(x, y, where))] };
  }
  throw new Error(`Unexpected True inside a condition in ${where}`);
}

function toMatch(n: Node, where: string): Match {
  const match: Match = {};
  const conjuncts = (x: Node): Node[] => (x.t === 'and' ? x.parts.flatMap(conjuncts) : [x]);
  for (const part of conjuncts(n)) {
    if (part.t === 'true') continue;
    const { field, alts } = singleField(part, where);
    const existing = match[field];
    if (!existing) match[field] = alts;
    else if (existing.length === 1 && alts.length === 1)
      match[field] = [intersect(existing[0]!, alts[0]!, where)];
    else throw new Error(`Field "${field}" constrained twice with alternatives in ${where}`);
  }
  return match;
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------
function convertValue(
  fn: string,
  value: number | string,
): { value: CellValue; sourceExpression?: string } {
  if (typeof value === 'number') return { value };
  const m = /^\s*(\d+(?:\.\d+)?)\s*([*/])\s*(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    // Earth conductor (CPC) "2 * 150" means two parallel 150 mm2 conductors, not 300 mm2.
    if (fn === 'CPC' && m[2] === '*') {
      return { value: { kind: 'parallel', conductors: a, sizeMm2: b }, sourceExpression: value };
    }
    return { value: m[2] === '*' ? a * b : a / b, sourceExpression: value };
  }
  return { value: { kind: 'text', text: value }, sourceExpression: value };
}

// ---------------------------------------------------------------------------------------------
// Appendix E flags (values are NOT corrected; engineer sign-off pending, OI-07)
// ---------------------------------------------------------------------------------------------
const flag = (reference: string, note: string): ReviewFlag => ({
  status: REVIEW_STATUS,
  reference,
  note,
});
const eq = (row: Row, field: string): Literal | undefined =>
  row.match[field]?.length === 1 ? row.match[field][0]!.eq : undefined;
const includesEq = (row: Row, field: string, v: Literal) =>
  row.match[field]?.some((a) => a.eq === v) ?? false;

const DERATING_FUNCTIONS = new Set(['TEMPDE', 'STR', 'DLAY', 'GROUPD', 'GROUPJ']);

function reviewFor(fn: string, row: Row): ReviewFlag | undefined {
  if (fn === 'VU' && eq(row, 'TYP') === 'PVC' && eq(row, 'CAB') === 90) {
    return flag(
      'Appendix E item 2',
      'PVC voltage-drop table lists 90 mm2 instead of 95 mm2, so 95 mm2 PVC returns no value.',
    );
  }
  if (fn === 'VU' && eq(row, 'TYP') === 'XLPE' && [500, 630].includes(eq(row, 'CAB') as number)) {
    return includesEq(row, 'PHASES', 3)
      ? flag(
          'Appendix E item 3',
          'XLPE voltage-drop values for 500 and 630 mm2 are higher than for 400 mm2 (three-phase) - suspected data error.',
        )
      : flag(
          'Appendix E item 3 (same pattern)',
          'Single/two-phase XLPE 500 and 630 mm2 values are also higher than 400 mm2; not named in Appendix E - confirm.',
        );
  }
  if (DERATING_FUNCTIONS.has(fn) && row.fallback) {
    return flag(
      'Appendix E item 6 / OI-06',
      'CableSizer "else" value 1 (no derating) for inputs between table steps; must not be applied silently (FR-45).',
    );
  }
  if (fn === 'IM' && String(eq(row, 'MCCB') ?? '').startsWith('NS')) {
    return flag(
      'Appendix E item 9',
      'Breaker magnetic data is for the discontinued Merlin Gerin NS range.',
    );
  }
  if (fn === 'breaker' && [1, 2, 6, 8].includes(row.source)) {
    return flag(
      'Appendix E item 9',
      'Final-circuit breaker helper has gaps at 8 A and 13-14 A next to this row.',
    );
  }
  return undefined;
}

const FUNCTION_ISSUES: Record<string, ReviewFlag[]> = {
  breaker: [
    flag(
      'Appendix E item 9',
      'No row covers 8 A (code 1) or 13-14 A (codes 1, 3-10); those inputs return not found.',
    ),
  ],
  IM: [flag('Appendix E item 9', 'Magnetic data for the discontinued Merlin Gerin NS range.')],
};

// ---------------------------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------------------------
function argType(fn: string, arg: string, rules: SourceRule[]): FunctionTable['args'][number] {
  const kinds = new Set<string>();
  for (const r of rules) {
    for (const m of r.when.matchAll(
      new RegExp(`\\b${arg}\\s*(?:==|<=|>=|<|>)\\s*("|-?\\d)`, 'g'),
    )) {
      kinds.add(m[1] === '"' ? 'string' : 'number');
    }
  }
  if (kinds.size === 0) throw new Error(`${fn}.${arg} never used`);
  const type = kinds.size === 2 ? 'number|string' : (kinds.values().next().value as 'number');
  return { name: arg, type };
}

function convert(sourceText: string) {
  const source = JSON.parse(sourceText) as SourceFile;
  let ruleCount = 0;
  const functions: Record<string, FunctionTable> = {};
  for (const [fn, def] of Object.entries(source)) {
    const rows = def.rules.map((rule, index): Row => {
      ruleCount++;
      const where = `${fn}[${index}] ${rule.when}`;
      const match = toMatch(parse(rule.when), where);
      for (const field of Object.keys(match)) {
        if (!def.args.includes(field)) throw new Error(`Unknown field "${field}" in ${where}`);
      }
      const row: Row = { source: index, match, ...convertValue(fn, rule.value) };
      if (rule.default) row.fallback = true;
      const review = reviewFor(fn, row);
      if (review) row.review = review;
      return row;
    });
    const table: FunctionTable = { args: def.args.map((a) => argType(fn, a, def.rules)), rows };
    if (FUNCTION_ISSUES[fn]) table.knownIssues = FUNCTION_ISSUES[fn];
    functions[fn] = table;
  }
  return LookupTablesSchema.parse({
    format: 'neuromep.cablesizer-lookup/1',
    source: {
      path: SOURCE_PATH,
      sha256: createHash('sha256').update(sourceText).digest('hex'),
      ruleCount,
    },
    evaluation:
      'First match: rows are checked in order; the first row whose every field condition holds gives the value. ' +
      'A field lists alternatives (any one may hold); fields not listed are not constrained. ' +
      'No matching row means not found - there is no implicit default.',
    functions,
  });
}

/** Pretty-prints with one row per line so diffs stay readable. */
function format(tables: ReturnType<typeof convert>): string {
  const fns = Object.entries(tables.functions).map(([name, t]) => {
    const rows = t.rows.map((r) => `        ${JSON.stringify(r)}`).join(',\n');
    const issues = t.knownIssues ? `,\n      "knownIssues": ${JSON.stringify(t.knownIssues)}` : '';
    return `    ${JSON.stringify(name)}: {\n      "args": ${JSON.stringify(t.args)},\n      "rows": [\n${rows}\n      ]${issues}\n    }`;
  });
  const head = JSON.stringify({ ...tables, functions: undefined }, null, 2).replace(/\n}$/, '');
  return `${head},\n  "functions": {\n${fns.join(',\n')}\n  }\n}\n`;
}

const sourceText = readFileSync(`${REPO_ROOT}${SOURCE_PATH}`, 'utf8');
const tables = convert(sourceText);
writeFileSync(OUTPUT, format(tables));
const flagged = Object.values(tables.functions).flatMap((t) => t.rows.filter((r) => r.review));
console.log(
  `Converted ${tables.source.ruleCount} rules in ${Object.keys(tables.functions).length} functions; ` +
    `${flagged.length} rows flagged "${REVIEW_STATUS}". Written to ${OUTPUT}`,
);
