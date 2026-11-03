import type { Cable } from '@neuromep/shared';
import { describe, expect, it } from 'vitest';
import { cableRating, voltageDrop, type Site } from './capacity.js';

type C = Cable['construction'];
/** Appendix C example 2: 4C Cu/XLPE on one tray, 6 circuits spaced D, 50 deg C, 40 m, pf 0.85. */
const TRAY: C = {
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
const SITE: Site = { airC: 50, groundC: 40, soilResistivity: 2 };
const izOf = (size: number, c: C = TRAY) => {
  const r = cableRating(c, 3, size, 1, SITE);
  if (!r.ok) throw new Error(r.detail);
  return r.izA;
};
const vdOf = (size: number, ib: number, phases: 1 | 3 = 3, c: C = TRAY) => {
  const r = voltageDrop(c, phases, size, 1, ib, 0.85, 40);
  if (!r.ok) throw new Error(r.detail);
  return r.vcPct;
};

describe('#TASK-21 current-carrying capacity C1 (10.6, CableSizer tables)', () => {
  it('Appendix C example 2: Iz 32.5 / 41.3 / 57.6 / 73.1 A for 4 / 6 / 10 / 16 mm²', () => {
    expect(izOf(4)).toBeCloseTo(32.5, 1);
    expect(izOf(6)).toBeCloseTo(41.3, 1);
    expect(izOf(10)).toBeCloseTo(57.6, 1);
    expect(izOf(16)).toBeCloseTo(73.1, 1);
    const r = cableRating(TRAY, 3, 10, 1, SITE);
    expect(r).toMatchObject({ ok: true, itA: 78, k1: 0.82, k2: 0.9, kr: 1, k3: 1 });
  });

  it('multiplies by the number of parallel runs', () => {
    const one = cableRating(TRAY, 3, 240, 1, SITE);
    const three = cableRating(TRAY, 3, 240, 3, SITE);
    expect(one.ok && three.ok && three.izA / one.izA).toBeCloseTo(3, 9);
  });

  it('between table steps takes the more conservative step (3 Nov 2026): 48 deg C uses 50 deg C', () => {
    const at = (airC: number) => {
      const r = cableRating(TRAY, 3, 10, 1, { ...SITE, airC });
      return r.ok ? r : null;
    };
    expect(at(48)!.k1).toBe(at(50)!.k1);
    expect(at(48)!.k1).toBeLessThan(at(45)!.k1);
    expect(at(48)!.notes.join(' ')).toMatch(
      /TEMP 48 between 45 and 50; 50 used \(lower factor, conservative\)/,
    );
  });

  it('derates buried cables for ground temperature, soil resistivity and depth', () => {
    const buried: C = {
      ...TRAY,
      method: 'D-direct',
      separation: 'touching',
      groupedCircuits: 2,
      depthM: 0.8,
    };
    const r = cableRating(buried, 3, 95, 1, SITE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kr).toBeLessThan(1); // 2.0 K.m/W is worse than the table's 1.2 reference
      expect(r.izA).toBeCloseTo(r.itA * r.k1 * r.k2 * r.kr * r.k3, 9);
    }
  });

  it('warns on a suspected table error: 300 mm² rated below 240 mm² (E2103, V-12)', () => {
    const conduit: C = { ...TRAY, cores: '3C', method: 'B', separation: null, trays: null };
    const r = cableRating(conduit, 3, 300, 1, SITE);
    expect(r.ok && r.warnings[0]).toMatch(/^E2103: NOMRATCU rates 300 mm² at 461 A, below 240 mm²/);
  });

  it('blocks instead of assuming: missing grouping, trays, depth, temperature, FR cable', () => {
    const reason = (c: C, site = SITE) => {
      const r = cableRating(c, 3, 10, 1, site);
      return r.ok ? 'ok' : `${r.code} ${r.detail}`;
    };
    expect(reason({ ...TRAY, groupedCircuits: null })).toMatch(/E2102 Enter the number of grouped/);
    expect(reason({ ...TRAY, trays: null })).toMatch(/Enter the number of trays/);
    expect(reason({ ...TRAY, separation: null })).toMatch(/Enter the separation/);
    expect(reason({ ...TRAY, method: 'D-duct', separation: 'touching', depthM: null })).toMatch(
      /depth of laying/,
    );
    expect(reason(TRAY, { ...SITE, airC: null })).toMatch(/air temperature/);
    expect(reason(TRAY, { ...SITE, airC: 70 })).toMatch(/outside the TEMPDE table range/);
    // Fire-rated cable: XLPE ratings on trays (FP600); no catalogue rating in conduit or buried.
    expect(
      reason({ ...TRAY, insulation: 'FR', method: 'B', trays: null, separation: null }),
    ).toMatch(/trays and free air only \(FP600 catalogue\)/);
    const fr = cableRating({ ...TRAY, insulation: 'FR' }, 3, 10, 1, SITE);
    const xlpe = cableRating(TRAY, 3, 10, 1, SITE);
    expect(fr.ok && xlpe.ok && fr.izA === xlpe.izA).toBe(true);
    // Grouping beyond the table blocks (V-13): the buried table stops at 6 circuits.
    const sevenBuried: C = { ...TRAY, method: 'D-direct', separation: 'touching', depthM: 0.8 };
    expect(reason({ ...sevenBuried, groupedCircuits: 7 })).toMatch(
      /^E2102 No table value for GROUPD/,
    );
    const nominal = cableRating(TRAY, 3, 1000, 1, SITE);
    expect(nominal.ok ? '' : nominal.code).toBe('E2101');
  });
});

describe('#TASK-22 voltage drop C2 (10.7)', () => {
  it('Appendix C example 2 balanced (Ib 34.0 A): 2.31 % on 6 mm², 1.36 % on 10 mm²', () => {
    const ib = (20 * 1000) / (Math.sqrt(3) * 400 * 0.85);
    expect(vdOf(6, ib)).toBeCloseTo(2.31, 2);
    expect(vdOf(10, ib)).toBeCloseTo(1.36, 2);
  });

  it('Appendix C example 2 unbalanced (Ib 40.9 A): 1.64 % on 10 mm², 1.02 % on 16 mm²', () => {
    const ib = (8 * 1000) / (230 * 0.85);
    expect(vdOf(10, ib)).toBeCloseTo(1.64, 2);
    expect(vdOf(16, ib)).toBeCloseTo(1.02, 2);
  });

  it('uses r and x with the power factor from 25 mm², 2 / sqrt3 more for single-phase (V-15)', () => {
    const three = voltageDrop(TRAY, 3, 95, 1, 100, 0.85, 40);
    const one = voltageDrop(TRAY, 1, 95, 1, 100, 0.85, 40);
    expect(three.ok && one.ok).toBe(true);
    if (three.ok && one.ok) {
      expect(one.vuMvAm / three.vuMvAm).toBeCloseTo(2 / Math.sqrt(3), 9);
      expect(one.vcPct).toBeCloseTo((one.vcV / 230) * 100, 9);
    }
    const two = voltageDrop(TRAY, 3, 95, 2, 100, 0.85, 40);
    expect(three.ok && two.ok && three.vcV / two.vcV).toBeCloseTo(2, 9);
  });

  it('uses the PVC r / x tables for PVC and notes single-core values (V-15)', () => {
    const pvc = voltageDrop(
      { ...TRAY, insulation: 'PVC', cores: '1C', armour: 'AWA' },
      3,
      95,
      1,
      100,
      0.85,
      40,
    );
    expect(pvc.ok && pvc.notes.join(' ')).toMatch(/Single-core r \/ x/);
  });

  it('blocks aluminium from 25 mm² and sizes missing from the tables', () => {
    const al = voltageDrop({ ...TRAY, conductor: 'Al' }, 3, 95, 1, 100, 0.85, 40);
    expect(al.ok ? '' : al.detail).toMatch(/copper only/);
    const pvc300 = voltageDrop({ ...TRAY, insulation: 'PVC' }, 3, 300, 1, 100, 0.85, 40);
    expect(pvc300.ok ? '' : pvc300.code).toBe('E2102');
    const small = voltageDrop(TRAY, 3, 3, 1, 10, 0.85, 40);
    expect(small.ok ? '' : small.code).toBe('E2102');
    const frDrop = voltageDrop({ ...TRAY, insulation: 'FR' }, 3, 10, 1, 10, 0.85, 40);
    expect(frDrop.ok && frDrop.vuMvAm).toBe(4); // FP600 4C 10 mm²: 4.0 mV/A/m, as XLPE
    const pvcSmallMissing = voltageDrop({ ...TRAY, insulation: 'PVC' }, 3, 95, 1, 100, 0.85, 40);
    expect(pvcSmallMissing.ok).toBe(true);
  });
});
