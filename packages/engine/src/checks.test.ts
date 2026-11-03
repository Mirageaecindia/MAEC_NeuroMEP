import type { Cable, Element, Project } from '@neuromep/shared';
import { completeProject, sampleDb, testCable, testElement } from '@neuromep/shared/testing';
import { describe, expect, it } from 'vitest';
import { checkFeeders } from './checks.js';

const TRAY: Cable['construction'] = {
  cores: '4C',
  conductor: 'Cu',
  insulation: 'XLPE',
  armour: 'SWA',
  sheath: 'PVC',
  voltageGrade: '600/1000 V',
  method: 'J',
  trays: 1,
  depthM: null,
  separation: 'D',
  groupedCircuits: 6,
};

/** A straight cable of `lengthM` in total (route + the 1 m vertical, no allowance). */
function feeder(from: Element, to: Element, lengthM: number): Cable {
  const c = testCable(from, to);
  return {
    ...c,
    construction: TRAY,
    verticalM: 1,
    route: [
      { x: 0, y: 0 },
      { x: lengthM - 1, y: 0 },
    ],
  };
}

/** TX > MDB (5 m) > DB (40 m) carrying 20 kW balanced at pf 0.85 (Appendix C example 2). */
function network(): Project {
  const p = completeProject();
  p.calculation.demandFactors.byLoadType['2'] = { value: 1, source: 'user' };
  p.calculation.defaultOverrides = { cableLengthAllowancePct: 0 };
  const f = p.building.floors[0]!.id;
  const tx = { ...testElement('transformer', 'tx', f), tag: 'TX-1' };
  const mdb = { ...testElement('mdb', 'mdb', f), tag: 'MDB-1' };
  const db = {
    ...sampleDb(f, 'db'),
    powerFactor: 0.85,
    loads: [
      { method: 'kw' as const, loadType: '2' as const, kwL1: 20 / 3, kwL2: 20 / 3, kwL3: 20 / 3 },
    ],
  } as Element;
  p.model.elements = [tx, mdb, db];
  p.model.cables = [feeder(tx, mdb, 5), feeder(mdb, db, 40)];
  return p;
}
const toDb = (p: Project) => checkFeeders(p).find((c) => c.toId === 'db')!;

describe('#TASK-21 / #TASK-22 C1 and C2 across the network (10.2 steps 4-6)', () => {
  it('starts at the DEWA minimum for the breaker and passes C1 and C2', () => {
    const p = network();
    const all = checkFeeders(p);
    const db = all.find((c) => c.toId === 'db')!;
    expect(db.size).toEqual({ sizeMm2: 10, runs: 1, from: 'dewa-minimum' });
    expect(db.lengthM).toBeCloseTo(40, 9);
    expect(db.rating?.izA).toBeCloseTo(57.6, 1);
    expect(db.c1).toBe('pass');
    expect(db.drop?.vcPct).toBeCloseTo(1.36, 2);
    // Cumulative: the transformer-to-MDB feeder's drop plus this one, against the DB limit 2.5 %.
    const mdb = all.find((c) => c.toId === 'mdb')!;
    expect(mdb.vdTotalPct).toBeCloseTo(mdb.drop!.vcPct, 9);
    expect(db.vdTotalPct).toBeCloseTo(mdb.vdTotalPct! + db.drop!.vcPct, 9);
    expect(db).toMatchObject({ vdLimitPct: 2.5, c2: 'pass', status: 'provisional' });
    expect(mdb.vdLimitPct).toBe(2);
  });

  it('a locked size is checked as locked: 4 mm² fails C1 (Iz 32.5 A < In 40 A)', () => {
    const p = network();
    p.model.cables[1]!.locks = { sizeMm2: 4, runs: 1, eccMm2: null };
    const db = toDb(p);
    expect(db.size?.from).toBe('locked');
    expect(db.c1).toBe('fail');
    expect(db.trace.find((t) => t.step === 'C1')?.detail).toMatch(/Iz 32\.5 A vs In 40 A: fail/);
  });

  it('fails C2 when the cumulative drop is above the limit', () => {
    const p = network();
    p.model.cables[1] = feeder(p.model.elements[1]!, p.model.elements[2]!, 120);
    expect(toDb(p).c2).toBe('fail');
  });

  it('blocks C1 when installation data is missing (E2102) and keeps going with C2', () => {
    const p = network();
    p.model.cables[1]!.construction = { ...TRAY, groupedCircuits: null };
    const db = toDb(p);
    expect(db).toMatchObject({ c1: 'blocked', status: 'blocked' });
    expect(db.errors).toContain('E2102');
    expect(db.c2).toBe('pass');
  });

  it('across a riser (drop unknown, OI-13) takes the board above at its full allowance (10.13)', () => {
    const p = network();
    p.model.cables = [p.model.cables[0]!];
    p.model.risers = [{ id: 'r1', lengthM: 30, widthM: 1, fedFromId: 'mdb', feeds: ['db'] }];
    const sm = { ...testElement('smdb', 'sm', p.building.floors[0]!.id), tag: 'SM' };
    p.model.elements.push(sm);
    p.model.risers[0]!.feeds = ['sm'];
    p.model.cables.push(feeder(sm, p.model.elements[2]!, 40));
    const db = toDb(p);
    expect(db.vdUpstreamPct).toBe(2); // SMDB limit
    expect(db.vdTotalPct).toBeCloseTo(2 + 1.36, 2);
    expect(db.c2).toBe('fail'); // 3.36 % > DB 2.5 %
    expect(db.trace.find((t) => /full allowance 2 %/.test(t.detail))).toBeTruthy();
  });

  it('busbar feeders wait for the busbar datasheet (OI-13)', () => {
    const p = network();
    p.model.cables[0]!.feederType = 'busbar';
    const mdb = checkFeeders(p).find((c) => c.toId === 'mdb')!;
    expect(mdb).toMatchObject({ c1: 'blocked', status: 'blocked' });
    expect(mdb.trace.at(-1)?.detail).toMatch(/OI-13/);
  });

  it('takes the limit of the board fed (MCC 2 %, final circuits 4 %) and the Lead override', () => {
    const p = network();
    const f = p.building.floors[0]!.id;
    const mcc = { ...testElement('mcc', 'mcc', f), tag: 'MCC-1' };
    const iso = {
      ...testElement('mdb', 'iso', f),
      kind: 'isolator',
      poles: 'TP',
      loadCategory: 'normal',
      demandCategory: null,
      manualLoads: [{ method: 'kw', loadType: '2', kwL1: 1, kwL2: 1, kwL3: 1 }],
      standbyKw: null,
      earthLeakage: null,
      efficiency: null,
      starter: null,
    } as unknown as Element;
    p.model.elements.push(mcc, iso);
    p.model.cables.push(feeder(p.model.elements[1]!, mcc, 10), feeder(mcc, iso, 10));
    p.calculation.defaultOverrides = { cableLengthAllowancePct: 0, 'voltageDropLimitPct.DB': 3 };
    const all = checkFeeders(p);
    expect(all.find((c) => c.toId === 'iso')?.vdLimitPct).toBe(4);
    expect(all.find((c) => c.toId === 'db')?.vdLimitPct).toBe(3);
  });

  it('blocks when the breaker has no DEWA minimum size and nothing is locked (E2101)', () => {
    const p = network();
    const db = p.model.elements[2] as Extract<Element, { kind: 'db' }>;
    db.loads = [{ method: 'kw', loadType: '2', kwL1: 700, kwL2: 700, kwL3: 700 }];
    const d = toDb(p);
    expect(d.device?.ratingA).toBe(4000);
    expect(d).toMatchObject({ size: null, c1: 'blocked', status: 'blocked' });
    expect(d.errors).toContain('E2101');
  });

  it('checks a single-phase feeder on 230 V', () => {
    const p = network();
    const db = p.model.elements[2] as Extract<Element, { kind: 'db' }>;
    db.loads = [{ method: 'kw', loadType: '2', kwL1: 3, kwL2: 0, kwL3: 0 }];
    const d = toDb(p);
    expect(d.ibCase).toBe('single-phase');
    expect(d.drop?.vcPct).toBeCloseTo((d.drop!.vcV / 230) * 100, 9);
  });

  it('reports a suspected table error found while checking (E2103)', () => {
    const p = network();
    p.model.cables[1]!.construction = {
      ...TRAY,
      cores: '3C',
      method: 'B',
      trays: null,
      separation: null,
    };
    p.model.cables[1]!.locks = { sizeMm2: 300, runs: 1, eccMm2: null };
    const d = toDb(p);
    expect(d.errors).toContain('E2103');
    expect(d.warnings[0]).toMatch(/suspected table error/);
  });

  it('blocks C1 and C2 for fire-rated cable until its table is mapped (OI-18)', () => {
    const p = network();
    p.model.cables[1]!.construction = { ...TRAY, insulation: 'FR' };
    expect(toDb(p)).toMatchObject({ c1: 'blocked', c2: 'blocked', status: 'blocked' });
  });

  it('runs no checks on a feeder that is Awaiting load', () => {
    const p = network();
    (p.model.elements[2] as Extract<Element, { kind: 'db' }>).loads = [];
    expect(toDb(p)).toMatchObject({
      status: 'awaiting-load',
      c1: 'not-run',
      c2: 'not-run',
      size: null,
    });
  });
});
