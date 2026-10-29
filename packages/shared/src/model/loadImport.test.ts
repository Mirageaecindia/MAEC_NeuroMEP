import { describe, expect, it } from 'vitest';
import { sampleDb } from '../testing.js';
import { loadTemplateHeader, parseLoadSheet, planLoadImport, type Cell } from './loadImport.js';

/** A sheet row: the DB tag, then values by header name. */
function sheet(rows: [string, Record<string, Cell>][]): Cell[][] {
  const header = loadTemplateHeader();
  return [
    header,
    ...rows.map(([tag, values]) => header.map((h, i) => (i === 0 ? tag : (values[h] ?? null)))),
  ];
}

describe('#TASK-15 DB loads from Excel (FR-35)', () => {
  it('has a DB tag column and five columns per load type', () => {
    const h = loadTemplateHeader();
    expect(h[0]).toBe('DB tag');
    expect(h).toHaveLength(1 + 12 * 5);
    expect(h.slice(1, 6)).toEqual([
      'Lighting L1 kW',
      'Lighting L2 kW',
      'Lighting L3 kW',
      'Lighting area m2',
      'Lighting W/m2',
    ]);
  });

  it('reads kW per phase (blank = 0) and area x W/m2 spread over three phases', () => {
    const { rows, problems } = parseLoadSheet(
      sheet([
        [
          'DB-GF-01',
          { 'Lighting L1 kW': 2, 'Lighting L3 kW': '1,5', 'Power area m2': 100, 'Power W/m2': 30 },
        ],
        ['', {}],
      ]),
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        row: 2,
        tag: 'DB-GF-01',
        lines: [
          { method: 'kw', loadType: '1', kwL1: 2, kwL2: 0, kwL3: 1.5 },
          { method: 'area', loadType: '2', areaM2: 100, wPerM2: 30, phases: '3P' },
        ],
      },
    ]);
  });

  it('reports unreadable rows with their row number', () => {
    const { rows, problems } = parseLoadSheet(
      sheet([
        ['DB-1', { 'Lighting L1 kW': -1 }],
        ['DB-2', { 'Power area m2': 50 }],
        ['DB-3', { 'Lighting L1 kW': 1 }],
        ['db-3', { 'Lighting L1 kW': 2 }],
      ]),
    );
    expect(rows.map((r) => r.tag)).toEqual(['DB-3']);
    expect(problems).toEqual([
      { row: 2, message: 'Lighting: values must be numbers of 0 or more (E1502).' },
      { row: 3, message: 'Power: enter both the area and W/m2.' },
      { row: 5, message: 'db-3 is also on row 4: one row per DB.' },
    ]);
    expect(parseLoadSheet([['Name', 'kW']]).problems[0]!.message).toMatch(/template header/);
  });

  it('matches rows to DBs by tag and lists unmatched rows (E1503) and changes', () => {
    const db = { ...sampleDb('f-gf', 'db-1'), tag: 'DB-GF-01' };
    const { rows } = parseLoadSheet(
      sheet([
        ['db-gf-01', { 'Lighting L1 kW': 3, 'Lighting L2 kW': 3, 'Lighting L3 kW': 3 }],
        ['DB-UNKNOWN', { 'Lighting L1 kW': 1 }],
      ]),
    );
    const plan = planLoadImport([db], rows);
    expect(plan.matched).toHaveLength(1);
    expect(plan.matched[0]).toMatchObject({ beforeKw: 0, afterKw: 9, changed: true });
    expect(plan.unmatched).toEqual([{ row: 3, tag: 'DB-UNKNOWN' }]);
  });
});
