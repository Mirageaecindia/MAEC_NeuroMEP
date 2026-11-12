import { describe, expect, it } from 'vitest';
import { sampleBuilder } from './sampleBuilder';

const TRAY = {
  cores: '4C',
  conductor: 'Cu',
  insulation: 'XLPE',
  armour: 'SWA',
  sheath: 'PVC',
  voltageGrade: '600/1000 V',
  method: 'J',
  trays: 1,
  depthM: null,
  separation: 'touching',
  groupedCircuits: 3,
} as const;

describe('#TASK-33 Revit exchange sample builder (user request 12 Nov 2026)', () => {
  it('places on the plan in PDF points, runs Cable Size and gives the points back in the package', () => {
    const b = sampleBuilder({
      id: 'test',
      name: 'Builder test',
      floors: { basements: 0, grounds: 1, podiums: 0, typicals: 1 },
      // 1000 pt = 50 m: 0.05 m per point.
      plans: {
        GF: {
          fileName: 'GF.pdf',
          widthPt: 2384,
          heightPt: 1684,
          rotationDeg: 90,
          calibration: { a: [0, 0], b: [1000, 0], metres: 50 },
        },
      },
    });
    b.place('transformer', 'GF', 'TX-1', [200, 300], { kva: 1000, primaryV: 11000 });
    b.place('mdb', 'GF', 'MDB-1', [600, 300], { demandCategories: ['office'] });
    b.place('db', 'GF', 'DB-1', [600, 900], {
      demandCategory: 'office',
      powerFactor: 0.85,
      loads: [{ method: 'kw', loadType: '2', kwL1: 10, kwL2: 10, kwL3: 10 }],
    });
    b.feed('TX-1', 'MDB-1', [], { ...TRAY, cores: '1C', armour: 'AWA', groupedCircuits: 1 });
    b.feed(
      'MDB-1',
      'DB-1',
      [
        [700, 300],
        [700, 900],
      ],
      TRAY,
    );
    const { exchange } = b.finish();

    const db = exchange.components.find((c) => c.tag === 'DB-1')!;
    expect(db.placement.pdf).toEqual({ x: 600, y: 900 });
    expect(db.placement.model).toEqual({ x: 30, y: 45 });
    expect(exchange.floors.find((f) => f.code === 'GF')!.plan).toMatchObject({
      pageRotationDeg: 90,
      calibration: { metresPerPoint: 0.05 },
    });
    const feeder = exchange.feeders.find((f) => f.to.tag === 'DB-1')!;
    expect(feeder.route!.pdf).toEqual([
      { x: 600, y: 300 },
      { x: 700, y: 300 },
      { x: 700, y: 900 },
      { x: 600, y: 900 },
    ]);
    // 800 pt routed = 40 m, + 5 m per cable (A-05).
    expect(feeder.length).toMatchObject({ routedM: 40, additionM: 5, totalM: 45 });
    expect(feeder.result).toMatchObject({
      outOfDate: false,
      device: { ratingA: expect.any(Number) },
    });
    expect(feeder.description).toMatch(/^\d+ x 4C \d+ mm² Cu\/XLPE\/SWA\/PVC/);
    expect(db.result?.device?.ratingA).toBe(feeder.result!.device!.ratingA);
  });
});
