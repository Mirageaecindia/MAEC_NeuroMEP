import type { Element, Project } from '@neuromep/shared';
import { completeProject, sampleDb, testCable, testElement } from '@neuromep/shared/testing';
import { describe, expect, it } from 'vitest';
import { designFeeders } from './design.js';

/** TX > MDB > DB with the DB loads given per phase (kW, load type 2, factor confirmed 1.0). */
function network(kw: [number, number, number], patchDb: Partial<Element> = {}): Project {
  const p = completeProject();
  p.calculation.demandFactors.byLoadType['2'] = { value: 1, source: 'user' };
  const f = p.building.floors[0]!.id;
  const tx = { ...testElement('transformer', 'tx', f), tag: 'TX-1' };
  const mdb = { ...testElement('mdb', 'mdb', f), tag: 'MDB-1' };
  const db = {
    ...sampleDb(f, 'db'),
    powerFactor: 0.85,
    loads: [
      { method: 'kw' as const, loadType: '2' as const, kwL1: kw[0], kwL2: kw[1], kwL3: kw[2] },
    ],
    ...patchDb,
  } as Element;
  p.model.elements = [tx, mdb, db];
  p.model.cables = [testCable(tx, mdb), testCable(mdb, db)];
  return p;
}
const feederTo = (p: Project, id: string) => designFeeders(p).find((d) => d.toId === id)!;

describe('#TASK-19 / #TASK-20 design current and protective devices (10.3 - 10.5)', () => {
  it('Appendix C example 2, balanced 20 kW at pf 0.85: Ib 34.0 A, In 40 A', () => {
    const d = feederTo(network([20 / 3, 20 / 3, 20 / 3]), 'db');
    expect(d.ibCase).toBe('three-phase');
    expect(d.ibA).toBeCloseTo(34.0, 1);
    expect(d.neutralA).toBeCloseTo(0, 6);
    expect(d.device).toMatchObject({ ratingA: 40, type: 'MCB', poles: '3P', imA: null, iaA: null });
    expect(d.status).toBe('provisional');
    expect(d.errors).toEqual([]);
  });

  it('Appendix C example 2, unbalanced 8 / 6 / 6 kW: largest phase Ib 40.9 A, In 50 A', () => {
    const d = feederTo(network([8, 6, 6]), 'db');
    expect(d.ibCase).toBe('unbalanced');
    expect(d.ibA).toBeCloseTo(40.9, 1);
    expect(d.neutralA).toBeCloseTo((2 * 1000) / (230 * 0.85), 6);
    expect(d.device?.ratingA).toBe(50);
  });

  it('single-phase load: Ib on 230 V, 1P device', () => {
    const d = feederTo(network([4.6, 0, 0]), 'db');
    expect(d.ibCase).toBe('single-phase');
    expect(d.ibA).toBeCloseTo((4.6 * 1000) / (230 * 0.85), 6);
    expect(d.device?.poles).toBe('1P');
  });

  it('carries the downstream demand: the transformer-to-MDB feeder gets a 4P incomer', () => {
    const d = feederTo(network([20 / 3, 20 / 3, 20 / 3]), 'mdb');
    expect(d.ibA).toBeCloseTo(34.0, 1);
    expect(d.device?.poles).toBe('4P');
  });

  it('a DB with no load is Awaiting load, with no device', () => {
    const d = feederTo(network([0, 0, 0]), 'db');
    expect(d).toMatchObject({ status: 'awaiting-load', ibA: 0, device: null });
  });

  it("uses the load type's power factor when the DB has none (Power 0.8, 12.2)", () => {
    const d = feederTo(network([5, 5, 5], { powerFactor: null } as Partial<Element>), 'db');
    expect(d.pf).toBe(0.8);
    expect(d.status).toBe('provisional');
  });

  it("uses the Technical Lead's override of a load type's power factor first", () => {
    const p = network([5, 5, 5], { powerFactor: null } as Partial<Element>);
    p.calculation.defaultOverrides = { 'loadPowerFactor.2': 0.9 };
    expect(feederTo(p, 'db').pf).toBe(0.9);
  });

  it('uses the default power factor (and its override) for a load type without one', () => {
    const kitchen = [{ method: 'kw' as const, loadType: '6' as const, kwL1: 5, kwL2: 5, kwL3: 5 }];
    const p = network([5, 5, 5], { powerFactor: null, loads: kitchen } as Partial<Element>);
    expect(feederTo(p, 'db').pf).toBe(0.85);
    p.calculation.defaultOverrides = { defaultLoadPowerFactor: 0.9 };
    expect(feederTo(p, 'db').pf).toBe(0.9);
  });

  it('refuses a project without a rule pack', () => {
    expect(() => designFeeders({ ...network([5, 5, 5]), rulePackId: null })).toThrow(/rule pack/);
  });

  it('blocks a motor without efficiency and a capacitor bank without rating (E2003)', () => {
    const p = network([5, 5, 5]);
    const f = p.building.floors[0]!.id;
    const mcc = testElement('mcc', 'mcc', f);
    const motor = {
      ...testElement('mdb', 'm', f),
      kind: 'motor',
      poles: 'TP',
      loadCategory: 'normal',
      demandCategory: null,
      manualLoads: [{ method: 'kw', loadType: '8', kwL1: 5, kwL2: 5, kwL3: 5 }],
      standbyKw: null,
      earthLeakage: null,
      efficiency: null,
      starter: null,
    } as unknown as Element;
    const pfc = { ...testElement('mdb', 'pfc', f), kind: 'pfc-bank' } as unknown as Element;
    p.model.elements.push(mcc, motor, pfc);
    p.model.cables.push(testCable(p.model.elements[1]!, mcc), testCable(mcc, motor));
    p.model.cables.push({
      ...testCable(p.model.elements[1]!, mcc),
      id: 'c-pfc',
      to: { elementId: 'pfc', port: 'in' },
    });
    const m = feederTo(p, 'm');
    expect(m).toMatchObject({ status: 'blocked', ibA: null });
    expect(m.errors[0]).toBe('E2003');
    expect(feederTo(p, 'pfc').errors[0]).toBe('E2003');
  });

  it('works out a motor current with its efficiency (10.4, V-06)', () => {
    const p = network([5, 5, 5]);
    const f = p.building.floors[0]!.id;
    const mcc = testElement('mcc', 'mcc', f);
    const motor = {
      ...testElement('mdb', 'm', f),
      kind: 'motor',
      poles: 'TP',
      loadCategory: 'normal',
      demandCategory: null,
      manualLoads: [{ method: 'kw', loadType: '8', kwL1: 5, kwL2: 5, kwL3: 5 }],
      standbyKw: null,
      earthLeakage: null,
      efficiency: 0.9,
      starter: null,
    } as unknown as Element;
    p.model.elements.push(mcc, motor);
    p.model.cables.push(testCable(p.model.elements[1]!, mcc), testCable(mcc, motor));
    const m = feederTo(p, 'm');
    expect(m.ibCase).toBe('motor');
    expect(m.ibA).toBeCloseTo((15 * 1000) / (Math.sqrt(3) * 400 * m.pf! * 0.9), 6);
  });

  it('works out a single-phase motor on 230 V', () => {
    const p = network([5, 5, 5]);
    const f = p.building.floors[0]!.id;
    const mcc = testElement('mcc', 'mcc', f);
    const motor = {
      ...testElement('mdb', 'm', f),
      kind: 'motor',
      poles: 'SP',
      loadCategory: 'normal',
      demandCategory: null,
      manualLoads: [{ method: 'kw', loadType: '8', kwL1: 2, kwL2: 0, kwL3: 0 }],
      standbyKw: null,
      earthLeakage: null,
      efficiency: 0.8,
      starter: null,
    } as unknown as Element;
    p.model.elements.push(mcc, motor);
    p.model.cables.push(testCable(p.model.elements[1]!, mcc), testCable(mcc, motor));
    const m = feederTo(p, 'm');
    expect(m.ibA).toBeCloseTo((2 * 1000) / (230 * m.pf! * 0.8), 6);
    expect(m.device?.poles).toBe('1P');
  });

  it('marks results Provisional: upstream not connected, TBC factors (E1901), not the CableSizer tables', () => {
    const p = network([5, 5, 5]);
    p.calculation.demandMethod = 'manual';
    p.calculation.demandFactors.byLoadType['2'] = { value: null, source: 'rulepack' };
    p.model.cables = p.model.cables.slice(1); // TX no longer feeds the MDB
    const d = feederTo(p, 'db');
    expect(d.provisionalReasons).toEqual(['upstream-not-connected', 'demand-factors-tbc']);
    expect(d.errors).toEqual(['E1901']);
  });

  it('blocks a current above the largest standard rating (E2001)', () => {
    const d = feederTo(network([3000, 3000, 3000]), 'db');
    expect(d).toMatchObject({ status: 'blocked', device: null });
    expect(d.errors[0]).toBe('E2001');
  });
});
