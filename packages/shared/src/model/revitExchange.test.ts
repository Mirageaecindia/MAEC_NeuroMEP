import { describe, expect, it } from 'vitest';
import { completeProject, sampleDb, testCable, testElement } from '../testing.js';
import type { Element } from './elements.js';
import { loadSummaries } from './loads.js';
import { REVIT_EXCHANGE_FORMAT, revitExchange } from './revitExchange.js';
import { inputsKey, type StoredResult } from './sizing.js';

const PFS = { defaultPf: 0.85, byType: {} };

/** GF plan calibrated at 0.1 m per point: TX > MDB > DB, a PFC bank and a meter on the DB. */
function project() {
  const p = completeProject();
  const gf = p.building.floors.find((f) => f.code === 'GF')!.id;
  const at = (e: Element, x: number, y: number) => ({ ...e, floorId: gf, position: { x, y } });
  const tx = at({ ...testElement('transformer', 'tx'), tag: 'TX-1' }, 10, 20);
  const mdb = at({ ...testElement('mdb', 'mdb'), tag: 'MDB-1', rotationDeg: 90 }, 30, 20);
  const db = at(
    {
      ...sampleDb(gf, 'db'),
      tag: 'DB-1',
      loads: [{ method: 'kw', loadType: '2', kwL1: 5, kwL2: 5, kwL3: 5 }],
    } as Element,
    30,
    50,
  );
  const pfc = at({ ...testElement('pfc', 'pfc'), tag: 'PFC-1' }, 35, 20);
  const meter = at(
    { ...testElement('meter', 'm'), tag: 'MTR-1', meterType: '3-Ph', meteredId: 'db' } as Element,
    31,
    48,
  );
  p.model.elements = [tx, mdb, db, pfc, meter];
  const feeder = { ...testCable(mdb, db), floorId: gf, route: [mdb.position, db.position] };
  p.model.cables = [
    { ...testCable(tx, mdb), floorId: gf, route: [tx.position, mdb.position] },
    feeder,
    { ...testCable(mdb, pfc), floorId: gf, route: [mdb.position, pfc.position] },
  ];
  return { p, gf, feeder };
}

const options = (p: ReturnType<typeof project>['p']) => ({
  summaries: loadSummaries(p, PFS),
  length: { allowancePct: 0, additionM: 5 },
  powerFactors: PFS,
  targetPf: 0.95,
  generatedAt: '2026-11-12T08:00:00.000Z',
  engineVersion: '0.1.0',
});

describe('#TASK-33 NeuroMEP -> Revit exchange (Section 16, user request 12 Nov 2026)', () => {
  it('gives every component its plan position in metres and in PDF points, with its links', () => {
    const { p, gf } = project();
    const x = revitExchange(p, options(p));
    expect(x).toMatchObject({ format: REVIT_EXCHANGE_FORMAT, version: '0.1.0' });
    const floor = x.floors.find((f) => f.id === gf)!;
    expect(floor.plan).toMatchObject({
      fileName: 'GF.pdf',
      pageWidthPt: 2384,
      calibration: { method: 'two-point', metresPerPoint: 0.1, realDistanceM: 50 },
    });
    const mdb = x.components.find((c) => c.tag === 'MDB-1')!;
    // 30 m / 0.1 m per point = 300 pt.
    expect(mdb.placement).toEqual({
      model: { x: 30, y: 20 },
      pdf: { x: 300, y: 200 },
      rotationDeg: 90,
      symbolScale: 1,
    });
    expect(mdb.fedFrom).toEqual([{ via: expect.any(String), from: 'TX-1', input: 'in' }]);
    expect(x.components.find((c) => c.tag === 'MTR-1')).toMatchObject({
      linkedTo: 'DB-1',
      load: null,
      properties: { meterType: '3-Ph', meteredId: 'db' },
    });
    // PFC: 15 kW at pf 0.85 corrected to 0.95.
    const tan = (pf: number) => Math.tan(Math.acos(pf));
    expect(x.components.find((c) => c.tag === 'PFC-1')!.pfc!.kvar).toBeCloseTo(
      15 * (tan(0.85) - tan(0.95)),
      2,
    );
    expect(x.components.find((c) => c.tag === 'DB-1')!.load).toMatchObject({
      totalConnectedKw: 15,
    });
  });

  it('gives feeders their route, length and last Cable Size result (marked out of date after a change)', () => {
    const { p, feeder } = project();
    const stored: StoredResult = {
      elementId: feeder.id,
      status: 'provisional',
      provisionalReasons: ['device-data-required'],
      errors: ['W2402'],
      sizedBy: 'C1',
      checks: { C1: { state: 'pass' } },
      size: { runs: 1, cores: '4C', sizeMm2: 10, eccMm2: 10, lengthM: 35 },
      device: { type: 'MCB', ratingA: 32, poles: '3P', faultRatingKa: 10 },
      load: null,
      values: {
        ibA: 25.47,
        inA: 32,
        izA: 52,
        vdOwnPct: 1.234,
        vdTotalPct: 1.5,
        ikMaxKa: 8.1,
        ikMinKa: 6.2,
        ipKa: null,
        zsMohm: null,
      },
      trace: [],
      runId: 'run-1',
      ranAt: '2026-11-12T08:00:00.000Z',
      engineVersion: '0.1.0',
      rulePackVersion: '1.0.0',
      inputsKey: inputsKey(p),
    };
    p.model.results = [stored];
    const f = revitExchange(p, options(p)).feeders.find((c) => c.neuromepId === feeder.id)!;
    expect(f.route!.pdf).toEqual([
      { x: 300, y: 200 },
      { x: 300, y: 500 },
    ]);
    expect(f.length).toMatchObject({ routedM: 30, additionM: 5, totalM: 35, typed: false });
    expect(f.description).toBe('1 x 4C 10 mm² Cu/XLPE/SWA/PVC + 1C 10 mm² ECC');
    expect(f.result).toMatchObject({
      status: 'provisional',
      outOfDate: false,
      device: { type: 'MCB', ratingA: 32, breakingCapacityKa: 10 },
      cable: { runs: 1, sizeMm2: 10 },
      voltageDropPct: { feeder: 1.23, total: 1.5 },
      checks: { C1: { name: 'Current-carrying capacity', state: 'pass' } },
    });
    // A change after the run: the package says the result is out of date.
    const dbEl = p.model.elements[2] as Extract<Element, { kind: 'db' }>;
    dbEl.loads = [{ method: 'kw', loadType: '2', kwL1: 9, kwL2: 5, kwL3: 5 }];
    const later = revitExchange(p, options(p));
    expect(later.feeders.find((c) => c.neuromepId === feeder.id)!.result).toMatchObject({
      status: 'out-of-date',
      outOfDate: true,
    });
    expect(later.summary.results.outOfDate).toBeGreaterThan(0);
  });
});
