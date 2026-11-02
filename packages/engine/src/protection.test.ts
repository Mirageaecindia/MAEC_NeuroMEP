import type { Cable, Element, Project } from '@neuromep/shared';
import { completeProject, sampleDb, testCable, testElement } from '@neuromep/shared/testing';
import { describe, expect, it } from 'vitest';
import { checkAll } from './protection.js';
import { tableValue } from './tables.js';

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

/** TX 1000 kVA > MDB (5 m) > DB (40 m, 20 kW, no ELCB); all optional checks ticked. */
function network(): Project {
  const p = completeProject();
  p.calculation.upstreamFaultMva = 350;
  p.calculation.checks = {
    ...p.calculation.checks,
    shortCircuit: true,
    letThroughEnergy: true,
    earthFaultLoopImpedance: true,
  };
  p.calculation.demandFactors.byLoadType['2'] = { value: 1, source: 'user' };
  p.calculation.defaultOverrides = { cableLengthAllowancePct: 0 };
  const f = p.building.floors[0]!.id;
  const tx = {
    ...testElement('transformer', 'tx', f),
    tag: 'TX-1',
    kva: 1000,
    ukPct: 5,
    urPct: 1.2,
  } as Element;
  const mdb = { ...testElement('mdb', 'mdb', f), tag: 'MDB-1' };
  const db = {
    ...sampleDb(f, 'db'),
    earthLeakage: 'none',
    powerFactor: 0.85,
    loads: [
      { method: 'kw' as const, loadType: '2' as const, kwL1: 20 / 3, kwL2: 20 / 3, kwL3: 20 / 3 },
    ],
  } as Element;
  p.model.elements = [tx, mdb, db];
  p.model.cables = [feeder(tx, mdb, 5), feeder(mdb, db, 40)];
  return p;
}
const toDb = (p: Project) => checkAll(p).find((c) => c.toId === 'db')!;

describe('#TASK-24 / #TASK-25 protection checks C4 - C6 (10.9 - 10.11)', () => {
  it('shows unticked checks as not selected on Page 1 (D-08)', () => {
    const p = network();
    p.calculation.checks = {
      ...p.calculation.checks,
      letThroughEnergy: false,
      earthFaultLoopImpedance: false,
    };
    const d = toDb(p);
    expect(d.c4.detail).toBe('Not calculated - not selected on Page 1');
    expect(d.c5.detail).toBe('Not calculated - not selected on Page 1');
  });

  it('C6: the DEWA starting size passes; a locked smaller size fails', () => {
    expect(toDb(network()).c6).toMatchObject({ state: 'pass' });
    const p = network();
    p.model.cables[1]!.locks = { sizeMm2: 6, runs: 1, eccMm2: null };
    expect(toDb(p).c6.state).toBe('fail');
  });

  it('sizes the earth conductor from the CPC table as Cu / PVC', () => {
    const d = toDb(network());
    expect(d.eccMm2).toBe(10);
    expect(d.trace.find((t) => t.step === 'ECC')?.detail).toBe(
      '1 x 10 mm² Cu/PVC (CPC table for 10 mm²)',
    );
  });

  it('C4 gives the cable withstand and waits for the breaker let-through (E2402)', () => {
    const d = toDb(network());
    expect(d.c4.state).toBe('device-data-required');
    const ik = d.faultAtBreaker!.ikMaxKa * 1000;
    const seconds = (143 * 10) ** 2 / (ik * ik);
    expect(d.c4.detail).toContain(`for ${seconds.toFixed(3)} s`);
    expect(d.errors).toContain('E2402');
    const main = checkAll(network()).find((c) => c.toId === 'mdb')!;
    expect(main.c4.detail).toMatch(/MV protection time \(OI-31\)/);
  });

  it('C5 works out Zs (hot) along the path and the trip current it allows', () => {
    const all = checkAll(network());
    const main = all.find((c) => c.toId === 'mdb')!;
    const db = all.find((c) => c.toId === 'db')!;
    // Loop per metre of the DB feeder, 10 mm² XLPE/SWA 4C with a 10 mm² Cu/PVC ECC.
    const rc = 1.83 * 1.6;
    const recc = 1.83 * 1.38;
    const ra =
      (
        tableValue('Ra', { MAT: 'CU', INS: 'XLPE', ARM: 'SWA', CORE: '4C', size: 10 }) as {
          value: number;
        }
      ).value *
      1.1 *
      1.28;
    const perM = rc + (recc * ra) / (recc + ra);
    expect(db.zsHotMohm).toBeCloseTo(main.zsHotMohm! + perM * 40, 6);
    expect(db.c5.state).toBe('device-data-required');
    expect(db.c5.detail).toContain(`Ia <= ${((0.95 * 230 * 1000) / db.zsHotMohm!).toFixed(0)} A`);
  });

  it('C5 is not required behind an ELCB (10.10)', () => {
    const p = network();
    p.model.elements[2] = { ...p.model.elements[2]!, earthLeakage: 'ELCB 30 mA' } as Element;
    expect(toDb(p).c5).toMatchObject({ state: 'not-required' });
  });

  it('C5 is not calculated across a riser (busbar loop unknown, OI-13)', () => {
    const p = network();
    const sm = { ...testElement('smdb', 'sm', p.building.floors[0]!.id), tag: 'SM' };
    p.model.elements.push(sm);
    p.model.risers = [{ id: 'r', lengthM: 20, widthM: 1, fedFromId: 'mdb', feeds: ['sm'] }];
    p.model.cables[1] = feeder(sm, p.model.elements[2]!, 40);
    expect(toDb(p).c5).toMatchObject({
      state: 'not-calculated',
      detail: expect.stringMatching(/OI-13/),
    });
  });

  it('C6 has no DEWA minimum above 2500 A', () => {
    const p = network();
    const db = p.model.elements[2] as Extract<Element, { kind: 'db' }>;
    db.loads = [{ method: 'kw', loadType: '2', kwL1: 700, kwL2: 700, kwL3: 700 }];
    p.model.cables[1]!.locks = { sizeMm2: 630, runs: 6, eccMm2: null };
    expect(toDb(p).c6).toMatchObject({
      state: 'not-calculated',
      detail: 'No DEWA minimum above 4000 A.',
    });
  });

  it('stops at a size the earth-conductor table does not cover', () => {
    const p = network();
    p.model.cables[1]!.locks = { sizeMm2: 1.5, runs: 1, eccMm2: null };
    const d = toDb(p);
    expect(d.eccMm2).toBeNull();
    expect(d.trace.find((t) => t.step === 'ECC')?.detail).toMatch(/No table value for CPC/);
  });

  it('single-core unarmoured: the loop runs through the ECC alone, with the table reactance', () => {
    const p = network();
    p.model.cables[1]!.construction = { ...TRAY, cores: '1C', armour: 'none' };
    const all = checkAll(p);
    const main = all.find((c) => c.toId === 'mdb')!;
    const db = all.find((c) => c.toId === 'db')!;
    const perM = Math.hypot(1.83 * 1.6 + 1.83 * 1.38, 0.132);
    expect(db.zsHotMohm).toBeCloseTo(main.zsHotMohm! + perM * 40, 6);
  });

  it('multicore unarmoured: the loop reactance is not in the CableSizer tables, so C5 waits', () => {
    const p = network();
    p.model.cables[1]!.construction = { ...TRAY, armour: 'none' };
    expect(toDb(p).c5).toMatchObject({
      state: 'not-calculated',
      detail: expect.stringMatching(/^No table value for X\(/),
    });
  });

  it('busbar feeders wait for their datasheet: no protection checks', () => {
    const p = network();
    p.model.cables[0]!.feederType = 'busbar';
    const main = checkAll(p).find((c) => c.toId === 'mdb')!;
    expect(main.c6.state).toBe('not-calculated');
    expect(main.eccMm2).toBeNull();
  });

  it('aluminium and fire-rated cables wait for their tables (OI-18)', () => {
    const p = network();
    p.model.cables[1]!.construction = { ...TRAY, insulation: 'FR' };
    const d = toDb(p);
    expect(d.c4.detail).toMatch(/OI-18/);
    expect(d.c5.detail).toMatch(/OI-18/);
  });
});
