import { describe, expect, it } from 'vitest';
import { completeProject } from '../testing.js';
import type { Cable, CableConstruction } from './cable.js';
import type { Element } from './elements.js';
import { isPlaceable, libraryItem, placeElement } from './library.js';
import { categoryFactorsPending, lineKw, loadSummaries } from './loads.js';
import { drawCable } from './wiring.js';

const construction: CableConstruction = {
  cores: '4C',
  conductor: 'Cu',
  insulation: 'XLPE',
  armour: 'SWA',
  sheath: 'PVC',
  voltageGrade: '600/1000 V',
  method: 'B',
  trays: null,
  depthM: null,
  separation: null,
  groupedCircuits: null,
};

function el(key: string, id: string, patch: Record<string, unknown> = {}): Element {
  const item = libraryItem(key)!;
  if (!isPlaceable(item)) throw new Error(key);
  const e = placeElement(item, {
    id,
    floorId: 'f',
    floorCode: 'GF',
    position: { x: 0, y: 0 },
    taken: [],
  });
  return { ...e, tag: id, ...patch } as Element;
}
function wire(pairs: [Element, Element][]): Cable[] {
  const cables: Cable[] = [];
  for (const [from, to] of pairs) {
    cables.push(
      drawCable({
        id: `c${cables.length}`,
        cables,
        from: { element: from, port: 'out' },
        to: { element: to, port: 'in' },
        route: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        floorCode: 'GF',
        construction,
      }),
    );
  }
  return cables;
}

describe('#TASK-16 load aggregation for the live load table (10.3, 10.2 step 2)', () => {
  it('reads kW per phase, or area x W/m2 on one phase or spread over three', () => {
    expect(lineKw({ method: 'kw', loadType: '1', kwL1: 1, kwL2: 2, kwL3: 3 })).toEqual({
      L1: 1,
      L2: 2,
      L3: 3,
    });
    expect(
      lineKw({ method: 'area', loadType: '2', areaM2: 100, wPerM2: 30, phases: 'L2' }),
    ).toEqual({
      L1: 0,
      L2: 3,
      L3: 0,
    });
    expect(
      lineKw({ method: 'area', loadType: '2', areaM2: 100, wPerM2: 30, phases: '3P' }),
    ).toEqual({
      L1: 1,
      L2: 1,
      L3: 1,
    });
  });

  it('applies load-type factors once per board, TBC as 1.0, and sums them at the transformer', () => {
    const project = completeProject();
    project.calculation.demandMethod = 'manual'; // load-type factors at every board (A-15)
    project.calculation.demandFactors.byLoadType['1'] = { value: 0.8, source: 'user' }; // Lighting
    // Power ('2') stays TBC.
    const db1 = el('db', 'DB1', {
      powerFactor: 0.9,
      standbyKw: 2,
      loads: [
        { method: 'kw', loadType: '1', kwL1: 2, kwL2: 2, kwL3: 2 },
        { method: 'area', loadType: '2', areaM2: 100, wPerM2: 30, phases: 'L1' },
      ],
    });
    const db2 = el('db', 'DB2', {
      loads: [{ method: 'kw', loadType: '1', kwL1: 1, kwL2: 1, kwL3: 1 }],
    });
    const smdb = el('smdb', 'SMDB', {
      manualLoads: [{ method: 'kw', loadType: '2', kwL1: 1, kwL2: 1, kwL3: 1 }],
    });
    const tx = el('transformer', 'TX');
    project.model.elements = [tx, smdb, db1, db2];
    project.model.cables = wire([
      [tx, smdb],
      [smdb, db1],
      [smdb, db2],
    ]);
    const s = loadSummaries(project, 0.85);

    // DB1: connected L1 = 2 + 3, L2 = 2, L3 = 2; demand = lighting x 0.8 + power x 1.0 (TBC).
    const d1 = s.get('DB1')!;
    expect(d1.connected).toEqual({ L1: 5, L2: 2, L3: 2 });
    expect(d1.demand.L1).toBeCloseTo(1.6 + 3, 9);
    expect(d1.maxDemandKw).toBeCloseTo(4.8 + 3, 9);
    expect(d1.tbcFactors).toEqual(['2']);
    expect(d1.currentA).toBeCloseTo((4.6 * 1000) / (230 * 0.9), 9);
    expect(d1.standbyKw).toBe(2);

    // SMDB: lighting 6 + 3 = 9 kW, power 3 + 3 = 6 kW, factors applied once to the connected load.
    const sm = s.get('SMDB')!;
    expect(sm.connectedKw).toBeCloseTo(15, 9);
    expect(sm.maxDemandKw).toBeCloseTo(9 * 0.8 + 6, 9);
    expect(sm.standbyKw).toBe(2); // acquired from DB1 (DB2 has none entered)

    // Transformer: the maximum demand of the board it feeds, no second factor.
    expect(s.get('TX')!.maxDemandKw).toBeCloseTo(sm.maxDemandKw, 9);
  });

  it('uses a panel override before the Page 1 factor (D-03) and an equivalent pf for sums', () => {
    const project = completeProject();
    project.calculation.demandMethod = 'manual'; // load-type factors at every board (A-15)
    const db = el('db', 'DB', {
      powerFactor: 1,
      loads: [{ method: 'kw', loadType: '1', kwL1: 3, kwL2: 3, kwL3: 3 }],
    });
    const db2 = el('db', 'DB2', {
      powerFactor: 0.6,
      loads: [{ method: 'kw', loadType: '1', kwL1: 1, kwL2: 1, kwL3: 1 }],
    });
    const smdb = el('smdb', 'SMDB', { demandFactorOverrides: { '1': 0.5 } });
    project.model.elements = [smdb, db, db2];
    project.model.cables = wire([
      [smdb, db],
      [smdb, db2],
    ]);
    const sm = loadSummaries(project, 0.85).get('SMDB')!;
    expect(sm.maxDemandKw).toBeCloseTo(12 * 0.5, 9);
    // P = 12 kW, Q = 0 + 3 x tan(acos 0.6) = 4 kvar -> pf = 12 / 12.65
    expect(sm.pf).toBeCloseTo(12 / Math.hypot(12, 4), 9);
  });

  it('flags entered demand-category factors as not applied yet (OI-02)', () => {
    const project = completeProject();
    project.calculation.demandMethod = 'manual'; // load-type factors at every board (A-15)
    expect(categoryFactorsPending(project)).toBe(false);
    project.calculation.demandFactors.byCategory.office = { value: 0.7, source: 'user' };
    expect(categoryFactorsPending(project)).toBe(true);
  });
});

describe('#TASK-19 Dubai demand method (manager 3 Nov 2026)', () => {
  /** TX > MDB > SMDB > residential DB (30 kW) and office DB (10 kW); a residential DB on the MDB. */
  function dubai(method: 'dubai-non-emaar' | 'dubai-emaar', secondLevel: number) {
    const project = completeProject();
    project.calculation.demandMethod = method;
    const cat = method === 'dubai-emaar' ? [0.6, 0.75, 0.8, 0.8] : [0.65, 0.8, 0.8, 0.8];
    const df = project.calculation.demandFactors;
    df.byCategory = {
      residential: { value: cat[0]!, source: 'rulepack' },
      landlord: { value: cat[1]!, source: 'rulepack' },
      office: { value: cat[2]!, source: 'rulepack' },
      retail: { value: cat[3]!, source: 'rulepack' },
    };
    df.secondLevel = { value: secondLevel, source: 'rulepack' };
    const tx = el('transformer', 'tx');
    const mdb = el('mdb', 'mdb');
    const sm = el('smdb', 'sm');
    const res = el('db', 'res', {
      demandCategory: 'residential',
      loads: [{ method: 'kw', loadType: '2', kwL1: 10, kwL2: 10, kwL3: 10 }],
    });
    const off = el('db', 'off', {
      demandCategory: 'office',
      loads: [{ method: 'kw', loadType: '1', kwL1: 4, kwL2: 3, kwL3: 3 }],
    });
    const res2 = el('db', 'res2', {
      demandCategory: 'residential',
      loads: [{ method: 'kw', loadType: '2', kwL1: 2, kwL2: 2, kwL3: 2 }],
    });
    project.model.elements = [tx, mdb, sm, res, off, res2];
    project.model.cables = wire([
      [tx, mdb],
      [mdb, sm],
      [sm, res],
      [sm, off],
      [mdb, res2],
    ]);
    return loadSummaries(project, 0.85);
  }

  it('non-Emaar: 100 % below the MDB; at the MDB residential x 0.65, office x 0.8', () => {
    const s = dubai('dubai-non-emaar', 1);
    expect(s.get('res')!.maxDemandKw).toBe(30); // DB at 100 %
    expect(s.get('sm')!.maxDemandKw).toBe(40); // SMDB at 100 % (non-Emaar)
    // MDB: residential (30 + 6) x 0.65 + office 10 x 0.8 = 31.4 kW.
    expect(s.get('mdb')!.maxDemandKw).toBeCloseTo(36 * 0.65 + 10 * 0.8, 9);
    expect(s.get('tx')!.maxDemandKw).toBeCloseTo(36 * 0.65 + 10 * 0.8, 9);
    expect(s.get('mdb')!.byCategory).toMatchObject({ residential: { L1: 12 }, office: { L1: 4 } });
  });

  it('Emaar: 0.8 at the SMDB; the MDB applies its factors to connected load, never multiplied', () => {
    const s = dubai('dubai-emaar', 0.8);
    expect(s.get('res')!.maxDemandKw).toBe(30);
    expect(s.get('sm')!.maxDemandKw).toBeCloseTo(40 * 0.8, 9);
    expect(s.get('mdb')!.maxDemandKw).toBeCloseTo(36 * 0.6 + 10 * 0.8, 9);
  });

  it('a TBC category factor counts as 1.0 and is reported (E1901)', () => {
    const project = completeProject();
    project.calculation.demandMethod = 'dubai-non-emaar';
    const tx = el('transformer', 'tx');
    const mdb = el('mdb', 'mdb');
    const res = el('db', 'res', {
      demandCategory: 'residential',
      loads: [{ method: 'kw', loadType: '2', kwL1: 1, kwL2: 1, kwL3: 1 }],
    });
    project.model.elements = [tx, mdb, res];
    project.model.cables = wire([
      [tx, mdb],
      [mdb, res],
    ]);
    const s = loadSummaries(project, 0.85); // completeProject: category factors TBC
    expect(s.get('mdb')!.maxDemandKw).toBe(3);
    expect(s.get('mdb')!.tbcCategories).toEqual(['residential']);
  });

  describe('power factor per load type (manager 3 Nov 2026)', () => {
    const pfs = { defaultPf: 0.85, byType: { '1': 0.85, '2': 0.8, '4': 1 } };
    const lines = [
      { method: 'kw' as const, loadType: '2' as const, kwL1: 10, kwL2: 10, kwL3: 10 }, // Power 0.8
      { method: 'kw' as const, loadType: '4' as const, kwL1: 10, kwL2: 10, kwL3: 10 }, // Heater 1.0
    ];
    const run = (
      dbPatch: Record<string, unknown>,
      powerFactors: Parameters<typeof loadSummaries>[1],
    ) => {
      const project = completeProject();
      const db = el('db', 'DB', { powerFactor: null, loads: lines, ...dbPatch });
      const smdb = el('smdb', 'SMDB');
      const tx = el('transformer', 'TX');
      project.model.elements = [tx, smdb, db];
      project.model.cables = wire([
        [tx, smdb],
        [smdb, db],
      ]);
      return loadSummaries(project, powerFactors);
    };

    it('adds P and Q per load type when the DB has no power factor of its own', () => {
      // P = 60 kW; Q = 30 x tan(acos 0.8) = 22.5 kVAr (heaters none): pf = 60 / hypot(60, 22.5).
      const s = run({}, pfs);
      expect(s.get('DB')!.pf).toBeCloseTo(60 / Math.hypot(60, 22.5), 12);
      expect(s.get('SMDB')!.pf).toBeCloseTo(60 / Math.hypot(60, 22.5), 12);
    });

    it("uses the DB's own power factor for all its loads when entered", () => {
      expect(run({ powerFactor: 0.9 }, pfs).get('DB')!.pf).toBe(0.9);
    });

    it('takes one load type exactly, and the default for a type without a value', () => {
      expect(run({ loads: [lines[0]] }, pfs).get('DB')!.pf).toBe(0.8);
      const kitchen = [{ ...lines[0]!, loadType: '6' as const }];
      expect(run({ loads: kitchen }, pfs).get('DB')!.pf).toBe(0.85);
    });

    it('leaves no power factor when a loaded type has none, up the tree too (V-14)', () => {
      const s = run({}, { defaultPf: null, byType: { '2': 0.8 } });
      expect(s.get('DB')!.pf).toBeNull();
      expect(s.get('DB')!.currentA).toBeNull();
      expect(s.get('SMDB')!.pf).toBeNull();
    });
  });
});
