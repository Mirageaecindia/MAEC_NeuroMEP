import { LOAD_TYPE_LABELS, LoadTypeCodeSchema, type LoadTypeCode } from '../project/enums.js';
import type { Element, LoadLine } from './elements.js';
import { lineKw } from './loads.js';

/**
 * DB loads from an Excel sheet (FR-35, #TASK-15): the NeuroMEP template has one row per DB tag
 * and, for each load type, kW on L1 / L2 / L3 and area x W/m2. Area loads in the sheet are spread
 * over three phases; a single-phase area load is entered in the DB properties.
 */

const COLUMNS = ['L1 kW', 'L2 kW', 'L3 kW', 'area m2', 'W/m2'] as const;
type Column = (typeof COLUMNS)[number];

/** Header row of the template: "DB tag", then five columns per load type. */
export function loadTemplateHeader(): string[] {
  return [
    'DB tag',
    ...LoadTypeCodeSchema.options.flatMap((c) =>
      COLUMNS.map((col) => `${LOAD_TYPE_LABELS[c]} ${col}`),
    ),
  ];
}

export type Cell = string | number | null | undefined;

export interface SheetRow {
  /** Row number in the sheet (1 = header). */
  row: number;
  tag: string;
  lines: LoadLine[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace('m²', 'm2');

/** Reads the template rows; returns the DB rows and the rows that cannot be read. */
export function parseLoadSheet(rows: Cell[][]): {
  rows: SheetRow[];
  problems: { row: number; message: string }[];
} {
  const header = (rows[0] ?? []).map((h) => norm(String(h ?? '')));
  const col = new Map(header.map((h, i) => [h, i]));
  if (!col.has('db tag')) {
    return {
      rows: [],
      problems: [{ row: 1, message: 'The first row must be the template header ("DB tag", …).' }],
    };
  }
  const index = (code: LoadTypeCode, c: Column) => col.get(norm(`${LOAD_TYPE_LABELS[code]} ${c}`));
  const out: SheetRow[] = [];
  const problems: { row: number; message: string }[] = [];
  const seen = new Map<string, number>();

  rows.slice(1).forEach((cells, i) => {
    const row = i + 2;
    const tag = String(cells[col.get('db tag')!] ?? '').trim();
    if (!tag) return; // empty line
    const value = (code: LoadTypeCode, c: Column): number | null | 'bad' => {
      const at = index(code, c);
      const raw = at === undefined ? null : cells[at];
      if (raw === null || raw === undefined || String(raw).trim() === '') return null;
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
      return Number.isFinite(n) && n >= 0 ? n : 'bad';
    };
    const lines: LoadLine[] = [];
    let problem: string | null = null;
    for (const code of LoadTypeCodeSchema.options) {
      const [l1, l2, l3, area, w] = COLUMNS.map((c) => value(code, c));
      if ([l1, l2, l3, area, w].includes('bad')) {
        problem = `${LOAD_TYPE_LABELS[code]}: values must be numbers of 0 or more (E1502).`;
        break;
      }
      if (l1 !== null || l2 !== null || l3 !== null) {
        lines.push({
          method: 'kw',
          loadType: code,
          kwL1: (l1 as number) ?? 0,
          kwL2: (l2 as number) ?? 0,
          kwL3: (l3 as number) ?? 0,
        });
      }
      if (area !== null || w !== null) {
        if (area === null || w === null) {
          problem = `${LOAD_TYPE_LABELS[code]}: enter both the area and W/m2.`;
          break;
        }
        lines.push({
          method: 'area',
          loadType: code,
          areaM2: area as number,
          wPerM2: w as number,
          phases: '3P',
        });
      }
    }
    const key = tag.toLowerCase();
    if (!problem && seen.has(key))
      problem = `${tag} is also on row ${seen.get(key)}: one row per DB.`;
    if (problem) problems.push({ row, message: problem });
    else {
      seen.set(key, row);
      out.push({ row, tag, lines });
    }
  });
  return { rows: out, problems };
}

const totalKw = (lines: readonly LoadLine[]) =>
  lines.reduce((s, l) => s + Object.values(lineKw(l)).reduce((a, b) => a + b, 0), 0);

export interface LoadImportPlan {
  matched: {
    element: Element & { kind: 'db' };
    lines: LoadLine[];
    beforeKw: number;
    afterKw: number;
    changed: boolean;
  }[];
  /** Rows whose DB name matches no DB tag in the project (E1503). */
  unmatched: { row: number; tag: string }[];
}

/** Matches sheet rows to DBs by tag (any case) and lists what would change (FR-35 preview). */
export function planLoadImport(elements: readonly Element[], rows: SheetRow[]): LoadImportPlan {
  const dbs = new Map(
    elements
      .filter((e): e is Element & { kind: 'db' } => e.kind === 'db')
      .map((e) => [e.tag.trim().toLowerCase(), e]),
  );
  const plan: LoadImportPlan = { matched: [], unmatched: [] };
  for (const r of rows) {
    const db = dbs.get(r.tag.toLowerCase());
    if (!db) {
      plan.unmatched.push({ row: r.row, tag: r.tag });
      continue;
    }
    const changed = JSON.stringify(db.loads) !== JSON.stringify(r.lines);
    plan.matched.push({
      element: db,
      lines: r.lines,
      beforeKw: totalKw(db.loads),
      afterKw: totalKw(r.lines),
      changed,
    });
  }
  return plan;
}
