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
  p.calculation.defaultOverrides = { cableLengthAllowancePct: 0 };
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

describe('#TASK-23 short-circuit currents to IEC 60909 (10.8, Appendix C example 1)', () => {
  it('transformer terminals: Z 7.2202 mOhm, Ik" 35.18 kA, ip 78.4 kA', () => {
    const t = okAt(levels(example1()), 'tx');
    expect(Math.hypot(t.rMax, t.xMax)).toBeCloseTo(7.2202, 3);
    expect(t.ikMaxKa).toBeCloseTo(35.18, 2);
    expect(t.ipKa).toBeCloseTo(78.4, 1);
  });

  it('LV panel after 3 x 630 mm² trefoil, 15 m: Z 7.6643 mOhm, Ik" 33.15 kA', () => {
    const lv = okAt(levels(example1()), 'lv');
    expect(Math.hypot(lv.rMax, lv.xMax)).toBeCloseTo(7.6643, 3);
    expect(lv.ikMaxKa).toBeCloseTo(33.15, 2);
  });

  it('minimum fault is lower (cmin, hot conductors, flat) and flagged for OI-33', () => {
    const db = okAt(levels(example1()), 'db');
    expect(db.ikMinKa).toBeLessThan(db.ikMaxKa);
    expect(db.notes.join(' ')).toMatch(/OI-33/);
  });

  it('uses the IEC 60076-5 minimum uk and the CableSizer ur when not entered', () => {
    const p = example1();
    p.model.elements[0] = { ...p.model.elements[0]!, ukPct: null, urPct: null } as Element;
    const t = okAt(levels(p), 'tx');
    expect(t.notes.join(' ')).toMatch(/uk 6 % \(IEC 60076-5 minimum for 1500 kVA\)/);
    expect(t.notes.join(' ')).toMatch(/ur [\d.]+ % \(CableSizer table\)/);
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

  it('notes that motor contribution is not included while IL/IF is open (OI-30)', () => {
    const p = example1();
    p.model.elements.push({
      ...testElement('mdb', 'm', p.building.floors[0]!.id),
      kind: 'motor',
    } as unknown as Element);
    expect(okAt(levels(p), 'tx').notes.join(' ')).toMatch(/OI-30/);
  });

  it('standby: generator X"d with KG, reached only through the ATS standby input', () => {
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
    const base = (400 * 400) / 500;
    const x = 0.14 * base * (1.1 / (1 + 0.14 * 0.6));
    expect(g.ikMaxKa).toBeCloseTo((1.1 * 400) / (Math.sqrt(3) * Math.hypot(0.15 * x, x)), 9);
    expect(g.ikMinKa).toBeCloseTo(3 / Math.hypot(0.15, 1), 9); // sustained 3 kA, RG = 0.15 XG
    expect(okAt(standby, 'ats').ikMaxKa).toBeLessThan(g.ikMaxKa);
    expect(standby.has('tx')).toBe(false);
    // Normal supply reaches the ATS only through its normal input, never the generator.
    expect(faultLevels(p, 'normal', sizes, lengths).has('gen')).toBe(false);
    const noData = { ...gen, xdSubtransientPct: null } as Element;
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

  it('notes a generator without its sustained short-circuit current (minimum from X"d)', () => {
    const p = example1();
    const gen = {
      ...testElement('generator', 'gen', p.building.floors[0]!.id),
      tag: 'GEN-1',
      kvaOverride: 500,
      xdSubtransientPct: 14,
      sustainedScKa: null,
    } as Element;
    p.model.elements.push(gen);
    const g = okAt(faultLevels(p, 'standby', new Map(), new Map()), 'gen');
    expect(g.notes.join(' ')).toMatch(/sustained short-circuit current not entered/);
    expect(g.ikMinKa).toBeCloseTo((0.95 / 1.1) * g.ikMaxKa, 9);
  });

  it('blocks aluminium cables and cables without a size on the fault path', () => {
    const p = example1();
    p.model.cables[1] = {
      ...p.model.cables[1]!,
      construction: { ...p.model.cables[1]!.construction, conductor: 'Al' },
    };
    expect(levels(p).get('db')).toMatchObject({ ok: false, code: 'E2102' });
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
    expect(main.faultAtBreaker?.ikMaxKa).toBeCloseTo(35.18, 2);
    // 180 kW needs an MCCB; 36 kA covers Ik" but its Icm (75.6 kA) is below ip 78.4 kA -> 50 kA.
    expect(main.duty).toMatchObject({ type: 'MCCB', icuKa: 50 });
    expect(main.c3).toBe('pass');
    expect(main.c7?.state).toBe('pass');
    expect(main.ikMinFarKa).toBeLessThan(33.15);
    const db = all.find((c) => c.toId === 'db')!;
    expect(db.faultAtBreaker?.ikMaxKa).toBeCloseTo(33.15, 2);
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
