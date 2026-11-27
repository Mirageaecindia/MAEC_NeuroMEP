import type { Cable, Element, Project } from '@neuromep/shared';
import { completeProject, sampleDb, testCable, testElement } from '@neuromep/shared/testing';
import { rulePackForRegion } from '@neuromep/rulepacks';
import { describe, expect, it } from 'vitest';
import { boardWithstand, breakerDuty, checkNetwork, makingFactor } from './duty.js';
import { faultLevels, type FaultResult } from './shortCircuit.js';

const devices = rulePackForRegion('dubai')!.devices;

/** A straight cable of `lengthM` in total (route + the 1 m vertical, no allowance). */
function feeder(
  from: Element,
  to: Element,
  lengthM: number,
  c: Partial<Cable['construction']> = {},
): Cable {
  const cable = testCable(from, to);
  return {
    ...cable,
    construction: {
      ...cable.construction,
      method: 'J',
      trays: 1,
      separation: 'touching',
      groupedCircuits: 1,
      ...c,
    },
    verticalM: 1,
    route: [
      { x: 0, y: 0 },
      { x: lengthM - 1, y: 0 },
    ],
  };
}

/**
 * Appendix C example 1: 1500 kVA (uk 6.25 %, ur 1.2 %), upstream 350 MVA, 3 x 1C 630 mm² Cu/XLPE
 * trefoil, 15 m to the LV panel; a DB below carries the load so the feeder has a breaker.
 */
function example1(): Project {
  const p = completeProject();
  p.calculation.upstreamFaultMva = 350;
  p.calculation.demandFactors.byLoadType['2'] = { value: 1, source: 'user' };
  p.calculation.defaultOverrides = { cableLengthAllowancePct: 0, cableLengthAdditionM: 1 };
  const f = p.building.floors[0]!.id;
  const tx = {
    ...testElement('transformer', 'tx', f),
    tag: 'TX-1',
    kva: 1500,
    ukPct: 6.25,
    urPct: 1.2,
  } as Element;
  const lv = { ...testElement('lv-panel', 'lv', f), tag: 'LV-1' };
  const db = {
    ...sampleDb(f, 'db'),
    powerFactor: 0.85,
    loads: [{ method: 'kw' as const, loadType: '2' as const, kwL1: 20, kwL2: 20, kwL3: 20 }],
  } as Element;
  const main = feeder(tx, lv, 15, { cores: '1C', armour: 'AWA' });
  main.locks = { sizeMm2: 630, runs: 3, eccMm2: null };
  p.model.elements = [tx, lv, db];
  p.model.cables = [main, feeder(lv, db, 30)];
  return p;
}

function levels(p: Project, scenario: 'normal' | 'standby' = 'normal') {
  // The main feeder is 3 x 630 mm�, 15 m; any other feeder 16 mm�, 30 m.
  const main = (c: Cable) => c.id === 'c-tx-lv';
  const sizes = new Map(
    p.model.cables.map((c) => [
      c.id,
      main(c) ? { sizeMm2: 630, runs: 3 } : { sizeMm2: 16, runs: 1 },
    ]),
  );
  const lengths = new Map(p.model.cables.map((c) => [c.id, main(c) ? 15 : 30]));
  return faultLevels(p, scenario, sizes, lengths);
}
const okAt = (m: Map<string, FaultResult>, id: string) => {
  const r = m.get(id);
  if (!r?.ok) throw new Error(r ? r.detail : `no result for ${id}`);
  return r;
};

describe('#TASK-23 short-circuit currents, CableSizer method (10.8, Appendix C example 1)', () => {
  it('transformer terminals as the CableSizer workbook: Z 7.122 mOhm, Isc 32.43 kA (c = 1, no KT)', () => {
    const t = okAt(levels(example1()), 'tx');
    expect(t.rMax).toBeCloseTo(1.325, 3); // workbook column BY
    expect(t.xMax).toBeCloseTo(6.997, 3); // BZ
    expect(Math.hypot(t.rMax, t.xMax)).toBeCloseTo(7.122, 3); // CA
    expect(t.ikMaxKa).toBeCloseTo(32.43, 2); // CC
    const kappa = 1.02 + 0.98 * Math.exp((-3 * t.rMax) / t.xMax);
    expect(t.ipKa).toBeCloseTo(kappa * Math.SQRT2 * t.ikMaxKa, 9);
  });

  it('LV panel after 3 x 1C 630 mm², 15 m (R 18.32 L / A N, X 0.09 L / N): Z 7.591 mOhm, 30.42 kA', () => {
    const lv = okAt(levels(example1()), 'lv');
    expect(lv.rMax).toBeCloseTo(1.471, 3);
    expect(lv.xMax).toBeCloseTo(7.447, 3);
    expect(Math.hypot(lv.rMax, lv.xMax)).toBeCloseTo(7.591, 3);
    expect(lv.ikMaxKa).toBeCloseTo(30.42, 2);
  });

  it('minimum fault uses conductor resistance at fault temperature (x 1.6 XLPE)', () => {
    const m = levels(example1());
    const lv = okAt(m, 'lv');
    const db = okAt(m, 'db');
    expect(db.ikMinKa).toBeLessThan(db.ikMaxKa);
    // At the LV panel only the main cable differs: R hot = 1.6 x cold.
    const rHot = lv.rMax + 0.6 * ((18.32 * 15) / (630 * 3));
    expect(lv.ikMinKa).toBeCloseTo(400 / (Math.sqrt(3) * Math.hypot(rHot, lv.xMax)), 9);
  });

  it('takes uk from the manufacturer catalogue and ur from CableSizer when not entered', () => {
    const p = example1();
    p.model.elements[0] = {
      ...p.model.elements[0]!,
      ukPct: null,
      urPct: null,
      primaryV: null,
    } as Element;
    const t = okAt(levels(p), 'tx');
    expect(t.notes.join(' ')).toMatch(/uk 6 % \(manufacturer catalogue, 1500 kVA, 11 kV assumed/);
    expect(t.notes.join(' ')).toMatch(/ur [\d.]+ % \(CableSizer table\)/);
    const q = example1();
    q.model.elements[0] = {
      ...q.model.elements[0]!,
      kva: 500,
      ukPct: null,
      primaryV: 11000,
    } as Element;
    expect(okAt(levels(q), 'tx').notes.join(' ')).toMatch(
      /uk 4 % \(manufacturer catalogue, 500 kVA, 11 kV\)/,
    );
    const r = example1();
    r.model.elements[0] = {
      ...r.model.elements[0]!,
      kva: 500,
      ukPct: null,
      primaryV: 20000,
    } as Element;
    expect(okAt(levels(r), 'tx').notes.join(' ')).toMatch(
      /uk 6 % \(manufacturer catalogue, 500 kVA, 20 kV\)/,
    );
  });

  it('blocks without source data (E2301)', () => {
    const p = example1();
    p.calculation.upstreamFaultMva = null;
    expect(levels(p).get('tx')).toMatchObject({ ok: false, code: 'E2301' });
    const q = example1();
    q.model.elements[0] = { ...q.model.elements[0]!, kva: null } as Element;
    expect(levels(q).get('tx')).toMatchObject({ ok: false, code: 'E2301' });
  });

  it('a riser adds no impedance to the maximum (safe side) and leaves no minimum (OI-13)', () => {
    const p = example1();
    p.model.cables = [p.model.cables[0]!];
    p.model.risers = [{ id: 'r', lengthM: 20, widthM: 1, fedFromId: 'lv', feeds: ['db'] }];
    const m = levels(p);
    expect(okAt(m, 'db').ikMaxKa).toBeCloseTo(okAt(m, 'lv').ikMaxKa, 9);
    expect(okAt(m, 'db').ikMinKa).toBeNull();
  });

  it('adds the motor group in parallel at the main LV panel (IL/IF 6.5, X 0.922 Z, R 0.42 X)', () => {
    const p = example1();
    const f = p.building.floors[0]!.id;
    const motor = {
      ...testElement('mdb', 'm', f),
      tag: 'M-1',
      kind: 'motor',
      poles: 'TP',
      loadCategory: 'normal',
      demandCategory: null,
      manualLoads: [{ method: 'kw', loadType: '8', kwL1: 10, kwL2: 10, kwL3: 10 }],
      standbyKw: null,
      earthLeakage: 'none',
      efficiency: 0.9,
      starter: null,
    } as unknown as Element;
    p.model.elements.push(motor);
    p.model.cables.push({ ...feeder(p.model.elements[1]!, motor, 20), id: 'c-lv-m' });
    const without = okAt(levels(example1()), 'lv');
    const lv = okAt(levels(p), 'lv');
    // By hand: SrM = 30 kW / (0.9 x 0.85), ZM = Vn² / (6.5 SrM), in parallel with the network.
    const srm = 30 / (0.9 * 0.85);
    const zm = (400 * 400) / (6.5 * srm);
    const m = { r: 0.42 * 0.922 * zm, x: 0.922 * zm };
    const n = { r: without.rMax, x: without.xMax };
    const num = { r: n.r * m.r - n.x * m.x, x: n.r * m.x + n.x * m.r };
    const den = { r: n.r + m.r, x: n.x + m.x };
    const d2 = den.r ** 2 + den.x ** 2;
    const z = { r: (num.r * den.r + num.x * den.x) / d2, x: (num.x * den.r - num.r * den.x) / d2 };
    expect(lv.rMax).toBeCloseTo(z.r, 9);
    expect(lv.xMax).toBeCloseTo(z.x, 9);
    expect(lv.ikMaxKa).toBeGreaterThan(without.ikMaxKa);
    expect(lv.notes.join(' ')).toMatch(
      /Motor contribution included: 39.2 kVA of motors, IL\/IF 6.5/,
    );
    // A motor without efficiency is left out, and says so.
    (p.model.elements.at(-1) as unknown as { efficiency: number | null }).efficiency = null;
    const none = okAt(levels(p), 'lv');
    expect(none.ikMaxKa).toBeCloseTo(without.ikMaxKa, 9);
    expect(none.notes.join(' ')).toMatch(/without M-1 \(efficiency missing\)/);
  });

  it('standby: generator X"d Vn² / S, R 0.1 X (no KG), reached only through the ATS standby input', () => {
    const p = example1();
    const f = p.building.floors[0]!.id;
    const gen = {
      ...testElement('generator', 'gen', f),
      tag: 'GEN-1',
      kvaOverride: 500,
      xdSubtransientPct: 14,
      sustainedScKa: 3,
    } as Element;
    const ats = { ...testElement('ats', 'ats', f), tag: 'ATS-1' };
    p.model.elements.push(gen, ats);
    p.model.cables = [
      { ...feeder(p.model.elements[0]!, ats, 5), to: { elementId: 'ats', port: 'normal' } },
      { ...feeder(gen, ats, 5), id: 'c-gen', to: { elementId: 'ats', port: 'standby' } },
    ];
    const sizes = new Map(p.model.cables.map((c) => [c.id, { sizeMm2: 240, runs: 2 }]));
    const lengths = new Map(p.model.cables.map((c) => [c.id, 5]));
    const standby = faultLevels(p, 'standby', sizes, lengths);
    const g = okAt(standby, 'gen');
    const x = 0.14 * ((400 * 400) / 500);
    expect(g.ikMaxKa).toBeCloseTo(400 / (Math.sqrt(3) * Math.hypot(0.1 * x, x)), 9);
    expect(g.ikMinKa).toBeCloseTo(3 / Math.hypot(0.1, 1), 9); // sustained 3 kA, R = 0.1 X
    expect(okAt(standby, 'ats').ikMaxKa).toBeLessThan(g.ikMaxKa);
    expect(standby.has('tx')).toBe(false);
    // Normal supply reaches the ATS only through its normal input, never the generator.
    expect(faultLevels(p, 'normal', sizes, lengths).has('gen')).toBe(false);
    const noData = { ...gen, kvaOverride: null } as Element;
    p.model.elements[3] = noData;
    expect(faultLevels(p, 'standby', sizes, lengths).get('gen')).toMatchObject({
      ok: false,
      code: 'E2301',
    });
  });

  it('a busbar feeder adds no impedance to the maximum and leaves no minimum (OI-13)', () => {
    const p = example1();
    p.model.cables[0] = { ...p.model.cables[0]!, feederType: 'busbar' };
    const m = levels(p);
    expect(okAt(m, 'lv').ikMaxKa).toBeCloseTo(okAt(m, 'tx').ikMaxKa, 9);
    expect(okAt(m, 'lv').ikMinKa).toBeNull();
    expect(okAt(m, 'lv').notes.join(' ')).toMatch(/Busbar impedance not included/);
  });

  it('generator without X"d: lowest of the typical range for the maximum, highest for the minimum', () => {
    const p = example1();
    const gen = {
      ...testElement('generator', 'gen', p.building.floors[0]!.id),
      tag: 'GEN-1',
      kvaOverride: 1000,
      xdSubtransientPct: null,
      sustainedScKa: null,
    } as Element;
    p.model.elements.push(gen);
    const g = okAt(faultLevels(p, 'standby', new Map(), new Map()), 'gen');
    const ikAt = (xd: number) => {
      const x = (xd / 100) * ((400 * 400) / 1000);
      return 400 / (Math.sqrt(3) * Math.hypot(0.1 * x, x));
    };
    expect(g.ikMaxKa).toBeCloseTo(ikAt(12), 9); // 500 - 2000 kVA: 12 - 16 %
    expect(g.ikMinKa).toBeCloseTo(ikAt(16), 9);
    expect(g.notes.join(' ')).toMatch(/X"d 12 - 16 % typical for 1000 kVA/);
  });

  it('calculates aluminium cables (rho 30.34) and blocks cables without a size', () => {
    const p = example1();
    p.model.cables[1] = {
      ...p.model.cables[1]!,
      construction: { ...p.model.cables[1]!.construction, conductor: 'Al' },
    };
    const al = okAt(levels(p), 'db');
    const cu = okAt(levels(example1()), 'db');
    expect(al.rMax - cu.rMax).toBeCloseTo(((30.34 - 18.32) * 30) / 16, 9);
    const empty = faultLevels(example1(), 'normal', new Map(), new Map());
    expect(empty.get('lv')).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/no size yet/),
    });
  });
});

describe('#TASK-23 fault duty C3 / C7 (V-10)', () => {
  it('making factor n of IEC 60947-2 Table 2', () => {
    expect([5, 8, 16, 36, 65].map(makingFactor)).toEqual([1.5, 1.7, 2.0, 2.1, 2.2]);
  });

  it('Appendix C example 1: ACB Icu 50 kA, Icm 105 kA >= ip 78.4 kA', () => {
    expect(breakerDuty(devices, 'ACB', 35.18, 78.4)).toEqual({
      type: 'ACB',
      icuKa: 50,
      icmKa: 105,
    });
  });

  it('moves up when Icm < ip, and to the next type when the type runs out; none above 85 kA', () => {
    expect(breakerDuty(devices, 'MCCB', 24, 60)).toMatchObject({ type: 'MCCB', icuKa: 36 });
    expect(breakerDuty(devices, 'MCB', 30, 40)).toMatchObject({ type: 'MCCB', icuKa: 36 });
    expect(breakerDuty(devices, 'ACB', 86, 150)).toBeNull();
  });

  it('switchboard withstand: Icw >= max(Ik", 40 kA), Ipk >= ip; asks for Icw / Ipk when missing', () => {
    const board = { ...testElement('lv-panel', 'b', 'f'), icwKa: null, ipkKa: null } as Element;
    expect(boardWithstand(board, 30, 60).state).toBe('not-calculated');
    expect(boardWithstand({ ...board, icwKa: 50, ipkKa: 105 } as Element, 33, 70).state).toBe(
      'pass',
    );
    expect(boardWithstand({ ...board, icwKa: 35, ipkKa: 105 } as Element, 30, 60).state).toBe(
      'fail',
    );
  });

  it('checkNetwork: duty at the breaker, minimum at the far end, C7 on the board fed', () => {
    const p = example1();
    p.model.elements[1] = { ...p.model.elements[1]!, icwKa: 50, ipkKa: 105 } as Element;
    const all = checkNetwork(p);
    const main = all.find((c) => c.toId === 'lv')!;
    expect(main.faultAtBreaker?.ikMaxKa).toBeCloseTo(32.43, 2);
    // 180 kW needs an MCCB; 36 kA covers Ik" 32.43 kA and its Icm 75.6 kA covers ip 72.2 kA.
    expect(main.faultAtBreaker?.ipKa).toBeCloseTo(72.2, 1);
    expect(main.duty).toMatchObject({ type: 'MCCB', icuKa: 36 });
    expect(main.c3).toBe('pass');
    expect(main.c7?.state).toBe('pass');
    expect(main.ikMinFarKa).toBeLessThan(30.42);
    const db = all.find((c) => c.toId === 'db')!;
    expect(db.faultAtBreaker?.ikMaxKa).toBeCloseTo(30.42, 2);
    expect(db.c7).toBeNull(); // a DB has no Icw field
  });

  it('checkNetwork: E2002 above 85 kA, E2301 when the source data is missing', () => {
    const p = example1();
    p.model.elements[0] = { ...p.model.elements[0]!, kva: 5000, ukPct: 4 } as Element;
    p.calculation.upstreamFaultMva = 10000;
    const main = checkNetwork(p).find((c) => c.toId === 'lv')!;
    expect(main).toMatchObject({ c3: 'fail', status: 'blocked' });
    expect(main.errors).toContain('E2002');
    const q = example1();
    q.calculation.upstreamFaultMva = null;
    const m = checkNetwork(q).find((c) => c.toId === 'lv')!;
    expect(m.c3).toBe('not-calculated');
    expect(m.errors).toContain('E2301');
  });
});
