import type { Alternative, CellValue, LookupTables, Row } from './schema.js';

export type LookupInput = Readonly<Record<string, number | string | null | undefined>>;

export type LookupResult = { found: true; value: CellValue; row: Row } | { found: false };

function alternativeHolds(alt: Alternative, v: number | string | null | undefined): boolean {
  if (alt.eq !== undefined && v !== alt.eq) return false;
  const bounded =
    alt.gt !== undefined || alt.gte !== undefined || alt.lt !== undefined || alt.lte !== undefined;
  if (!bounded) return true;
  if (typeof v !== 'number') return false;
  if (alt.gt !== undefined && !(v > alt.gt)) return false;
  if (alt.gte !== undefined && !(v >= alt.gte)) return false;
  if (alt.lt !== undefined && !(v < alt.lt)) return false;
  if (alt.lte !== undefined && !(v <= alt.lte)) return false;
  return true;
}

export function rowMatches(row: Row, input: LookupInput): boolean {
  return Object.entries(row.match).every(([field, alts]) =>
    alts.some((alt) => alternativeHolds(alt, input[field])),
  );
}

/**
 * First-match lookup: rows are checked in order and the first row whose conditions all hold wins.
 * No match returns `found: false` - never an implicit value (V-14). A matched `fallback` row is
 * CableSizer's "else" value; callers decide whether to accept it.
 */
export function lookup(tables: LookupTables, fn: string, input: LookupInput): LookupResult {
  const table = tables.functions[fn];
  if (!table) throw new Error(`Unknown CableSizer function "${fn}"`);
  const row = table.rows.find((r) => rowMatches(r, input));
  return row ? { found: true, value: row.value, row } : { found: false };
}
