import { describe, expect, it } from 'vitest';
import { sizeCables } from './autosize.js';
import { cableRating } from './capacity.js';
import { checkFeeders } from './checks.js';
import { building, TRAY } from './fixtures/network.js';

const SQRT3 = Math.sqrt(3);

/**
 * Appendix C example 2 through the sizing loop: TX > MDB > DB (40 m, 4C Cu/XLPE on one tray, 6
 * circuits spaced D, 50 deg C, pf 0.85) with the MDB feeder length set so that the drop up to the
 * MDB is exactly 1.0 % (10 mm², 4.0 mV/A/m), as in the example.
 */
function example2(kw: [number, number, number]) {
  const b = building();
  b.add('transformer', 'tx', { kva: 1000, ukPct: 5, urPct: 1.2 });
  b.add('mdb', 'mdb');
  b.db('db', kw);
  const ib =
    Math.max(...kw) === Math.min(...kw)
      ? (kw[0] * 3 * 1000) / (SQRT3 * 400 * 0.85)
      : (Math.max(...kw) * 1000) / (230 * 0.85);
  const lengthFor1Pct = (1.0 * 400 * 1000) / (100 * ib * 4.0);
  b.feed('tx', 'mdb', lengthFor1Pct);
  b.feed('mdb', 'db', 40);
  return b.project;
}

describe('#TASK-26 auto-sizing (10.13)', () => {
  it('Appendix C example 2 unbalanced 8 / 6 / 6 kW: 10 mm² fails C2 (2.64 %), 16 mm² selected, sized by C2', () => {
    const p = example2([8, 6, 6]);
    const run = sizeCables(p);
    expect(run.converged).toBe(true);
    const db = checkFeeders(p, run.sized).find((f) => f.toId === 'db')!;
    expect(db.vdUpstreamPct).toBeCloseTo(1.0, 6);
    expect(db.size).toMatchObject({ sizeMm2: 16, runs: 1, from: 'sized' });
    expect(db.vdTotalPct).toBeCloseTo(2.02, 2);
    expect(db.c1).toBe('pass');
    expect(db.c2).toBe('pass');
    expect(run.sizedBy.get(db.cableId)).toBe('C2');
  });

  it('Appendix C example 2 balanced: the DEWA minimum 10 mm² already passes (2.36 %), sized by C6', () => {
    const p = example2([20 / 3, 20 / 3, 20 / 3]);
    const run = sizeCables(p);
    const db = checkFeeders(p, run.sized).find((f) => f.toId === 'db')!;
    expect(db.size).toMatchObject({ sizeMm2: 10, from: 'dewa-minimum' });
    expect(db.vdTotalPct).toBeCloseTo(2.36, 2);
    expect(run.sizedBy.get(db.cableId)).toBe('C6');
  });

  it('upsizes for current-carrying capacity when grouping derates the DEWA size (sized by C1)', () => {
    const b = building();
    b.add('transformer', 'tx', { kva: 1000, ukPct: 5, urPct: 1.2 });
    b.add('mdb', 'mdb');
    b.db('db', [40, 40, 40]);
    b.feed('tx', 'mdb', 5, {
      cores: '1C',
      armour: 'AWA',
      groupedCircuits: 1,
      separation: 'touching',
    });
    // Conduit, 4C PVC, 9 circuits grouped: heavy derating, short run (no voltage-drop issue).
    const c = {
      method: 'B' as const,
      insulation: 'PVC' as const,
      trays: null,
      separation: null,
      groupedCircuits: 9,
    };
    b.feed('mdb', 'db', 5, c);
    const run = sizeCables(b.project);
    const db = checkFeeders(b.project, run.sized).find((f) => f.toId === 'db')!;
    // Independent check: the chosen (size, runs) is the first candidate - sizes ascending from the
    // DEWA minimum (120 mm� for 225 A), then one more run - whose Iz reaches In.
    const site = { airC: 50, groundC: 35, soilResistivity: 2 };
    const iz = (size: number, runs: number) => {
      const r = cableRating({ ...TRAY, ...c }, 3, size, runs, site);
      return r.ok ? r.izA : 0;
    };
    expect(db.device!.ratingA).toBe(225); // 120 kW at pf 0.85 = 203.8 A
    expect(iz(120, 1)).toBeLessThan(225);
    expect(db.c1).toBe('pass');
    const { sizeMm2, runs } = db.size!;
    expect(iz(sizeMm2, runs)).toBeGreaterThanOrEqual(225);
    const sizes = [
      1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630,
    ];
    for (let r = 1; r <= runs; r++) {
      for (const s of sizes) {
        if (s * r < 120 || (r === runs && s >= sizeMm2)) continue;
        expect(iz(s, r), `${r} x ${s} mm�`).toBeLessThan(225);
      }
    }
    expect(run.sizedBy.get(db.cableId)).toBe('C1');
  });

  it('adds parallel runs once the largest size of the construction is not enough', () => {
    const b = building();
    b.add('transformer', 'tx', { kva: 2000, ukPct: 6, urPct: 1 });
    b.add('mdb', 'mdb');
    b.db('db', [250, 250, 250]); // 750 kW at pf 0.85: 1273.6 A, In 1600 A
    b.feed('tx', 'mdb', 5, {
      cores: '1C',
      armour: 'AWA',
      groupedCircuits: 1,
      separation: 'touching',
    });
    b.feed('mdb', 'db', 20, { groupedCircuits: 1, separation: 'touching' });
    const run = sizeCables(b.project);
    const db = checkFeeders(b.project, run.sized).find((f) => f.toId === 'db')!;
    expect(db.device!.ratingA).toBe(1600);
    expect(db.size!.runs).toBeGreaterThan(1);
    expect(db.c1).toBe('pass');
    expect(db.rating!.izA).toBeGreaterThanOrEqual(1600);
    expect(db.size!.sizeMm2 * db.size!.runs).toBeGreaterThanOrEqual(2 * 630); // DEWA 1600 A
  });

  it('with one run allowed, no 4C size reaches the DEWA area for 1600 A: blocked E2101, not E2601', () => {
    const b = building();
    b.add('transformer', 'tx', { kva: 2000, ukPct: 6, urPct: 1 });
    b.add('mdb', 'mdb');
    b.db('db', [250, 250, 250]);
    b.feed('tx', 'mdb', 5, {
      cores: '1C',
      armour: 'AWA',
      groupedCircuits: 1,
      separation: 'touching',
    });
    b.feed('mdb', 'db', 20, { groupedCircuits: 1, separation: 'touching' });
    b.project.calculation.defaultOverrides = { cableLengthAllowancePct: 0, maxParallelRuns: 1 };
    const run = sizeCables(b.project);
    expect(run.converged).toBe(true);
    const db = checkFeeders(b.project, run.sized).find((f) => f.toId === 'db')!;
    expect(db.c1).toBe('blocked');
    expect(db.errors).toContain('E2101');
  });

  it('validates a locked size without changing it', () => {
    const p = example2([8, 6, 6]);
    p.model.cables[1]!.locks = { sizeMm2: 10, runs: 1, eccMm2: null };
    const run = sizeCables(p);
    const db = checkFeeders(p, run.sized).find((f) => f.toId === 'db')!;
    expect(db.size).toMatchObject({ sizeMm2: 10, from: 'locked' });
    expect(db.c2).toBe('fail');
    expect(run.sizedBy.has(db.cableId)).toBe(false);
  });

  it('restarts from the minimum on every run: a smaller load gives a smaller cable again', () => {
    const p = example2([8, 6, 6]);
    expect(sizeCables(p).sized.size).toBeGreaterThan(0);
    const db = p.model.elements.find((e) => e.id === 'db') as Extract<
      (typeof p.model.elements)[number],
      { kind: 'db' }
    >;
    db.loads = [{ method: 'kw', loadType: '2', kwL1: 1, kwL2: 1, kwL3: 1 }];
    const again = sizeCables(p);
    const f = checkFeeders(p, again.sized).find((x) => x.toId === 'db')!;
    expect(f.size?.from).toBe('dewa-minimum');
  });

  it('does not size what it cannot: missing installation input stays blocked (E2102)', () => {
    const p = example2([8, 6, 6]);
    p.model.cables[1]!.construction = { ...TRAY, groupedCircuits: null };
    const run = sizeCables(p);
    const db = checkFeeders(p, run.sized).find((f) => f.toId === 'db')!;
    expect(db.c1).toBe('blocked');
    expect(run.sized.has(db.cableId)).toBe(false);
  });
});
