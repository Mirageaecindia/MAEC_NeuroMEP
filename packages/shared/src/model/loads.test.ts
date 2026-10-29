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
    expect(categoryFactorsPending(project)).toBe(false);
    project.calculation.demandFactors.byCategory.office = { value: 0.7, source: 'user' };
    expect(categoryFactorsPending(project)).toBe(true);
  });
});
