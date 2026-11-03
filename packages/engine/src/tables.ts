import { cableSizerTables, lookup, type LookupInput } from '@neuromep/rulepacks/cablesizer';

/**
 * Access to the CableSizer v1.1 tables, the working tables for real calculations (decision
 * 2 Nov 2026, amends V-12). A missing value is never replaced: CableSizer's "else = 1" rows are
 * treated as not found (V-14). Rows flagged for engineer review (OI-07) are used, with a note.
 */
export type TableValue =
  { found: true; value: number; notes: string[] } | { found: false; detail: string };

const describe = (fn: string, input: LookupInput) =>
  `${fn}(${Object.entries(input)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')})`;

export function tableValue(fn: string, input: LookupInput): TableValue {
  const r = lookup(cableSizerTables, fn, input);
  if (!r.found || r.row.fallback || typeof r.value !== 'number') {
    return { found: false, detail: `No table value for ${describe(fn, input)}.` };
  }
  const notes = r.row.review ? [`${describe(fn, input)}: ${r.row.review.note}`] : [];
  return { found: true, value: r.value, notes };
}

/**
 * A rating factor at `x` between two table steps of `key`: the neighbouring step with the lower
 * factor, i.e. rounded up or down whichever is more conservative (manager's answer 3 Nov 2026,
 * replaces the linear interpolation of 10.1). Outside the table range the element is blocked.
 */
export function conservativeStep(
  fn: string,
  input: LookupInput,
  key: string,
  x: number,
): TableValue {
  const exact = tableValue(fn, { ...input, [key]: x });
  if (exact.found) return exact;
  const steps = new Set<number>();
  // `exact` above already threw for an unknown table.
  for (const row of cableSizerTables.functions[fn]!.rows) {
    for (const alt of row.match[key] ?? []) if (typeof alt.eq === 'number') steps.add(alt.eq);
  }
  const at = (k: number) => tableValue(fn, { ...input, [key]: k });
  const sorted = [...steps].sort((a, b) => a - b);
  const lo = sorted
    .filter((k) => k < x)
    .reverse()
    .find((k) => at(k).found);
  const hi = sorted.find((k) => k > x && at(k).found);
  if (lo === undefined || hi === undefined) {
    return {
      found: false,
      detail: `${key} ${x} is outside the ${fn} table range; the engine does not extrapolate.`,
    };
  }
  const a = at(lo) as Extract<TableValue, { found: true }>;
  const b = at(hi) as Extract<TableValue, { found: true }>;
  const [use, step] = a.value <= b.value ? [a, lo] : [b, hi];
  return {
    found: true,
    value: use.value,
    notes: [
      ...use.notes,
      `${fn}: ${key} ${x} between ${lo} and ${hi}; ${step} used (lower factor, conservative).`,
    ],
  };
}
