import { describe, expect, it } from 'vitest';
import { CableSchema } from './cable.js';
import { ElementSchema } from './elements.js';
import { CableSizeRunSchema } from './results.js';

const base = {
  id: 'e1',
  version: 0,
  tag: 'DB-3A',
  description: 'Small power',
  floorId: 'f3',
  position: { x: 12.5, y: 4 },
  location: 'Office 301',
  discipline: 'electrical',
  ipRating: 'IP42',
  fireRated: false,
};

const dbFields = {
  kind: 'db',
  poles: 'TPN',
  loadCategory: 'normal',
  incomerDevice: 'MCCB',
  earthLeakage: 'ELCB 30 mA',
  mounting: 'recessed',
  standbyKw: null,
  demandCategory: 'office',
  powerFactor: 0.85,
  thirdHarmonicPct: null,
};

const construction = {
  cores: '4C',
  conductor: 'Cu',
  insulation: 'XLPE',
  armour: 'SWA',
  sheath: 'PVC',
  voltageGrade: '600/1000 V',
  method: 'B',
  trays: 1,
  depthM: null,
  separation: 'D',
  groupedCircuits: 6,
};

describe('#TASK-12 / #TASK-13 network model schemas', () => {
  it('accepts a DB with loads per phase and by area', () => {
    const db = ElementSchema.parse({
      ...base,
      ...dbFields,
      loads: [
        { method: 'kw', loadType: '1', kwL1: 2, kwL2: 2, kwL3: 2 },
        { method: 'area', loadType: '2', areaM2: 120, wPerM2: 25, phases: '3P' },
      ],
    });
    expect(db.kind).toBe('db');
  });

  it('rejects an unknown element kind and a power factor below 0.5 (E1502)', () => {
    expect(ElementSchema.safeParse({ ...base, kind: 'toaster' }).success).toBe(false);
    const bad = { ...base, ...dbFields, loads: [], powerFactor: 0.4 };
    expect(ElementSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a cable with a route in metres and refuses single-core SWA', () => {
    const cable = {
      id: 'c1',
      version: 0,
      tag: 'F3-1-1',
      from: { elementId: 'smdb', port: 'out' },
      to: { elementId: 'e1', port: 'in' },
      circuitRef: '1RYB',
      floorId: 'f3',
      route: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 6 },
      ],
      verticalM: 3,
      construction,
      locks: { sizeMm2: null, runs: null, eccMm2: null },
    };
    expect(CableSchema.parse(cable).tag).toBe('F3-1-1');
    const oneCoreSwa = { ...cable, construction: { ...construction, cores: '1C' } };
    expect(CableSchema.safeParse(oneCoreSwa).success).toBe(false);
  });

  it('describes a Cable Size run with check states, including Not calculated', () => {
    const run = CableSizeRunSchema.parse({
      runId: 'run-1',
      projectId: 'p-1',
      scope: { kind: 'floor', floorId: 'f3' },
      startedAt: '2026-10-26T10:00:00.000Z',
      engineVersion: '0.0.0',
      rulePackId: 'dubai',
      rulePackVersion: '1.0.0',
      modelVersion: 4,
      results: [
        {
          elementId: 'c1',
          status: 'provisional',
          provisionalReasons: ['demand-factors-tbc', 'unverified-ampacity-tables'],
          errors: ['E1901'],
          sizedBy: 'C2',
          checks: {
            C1: { state: 'pass' },
            C2: { state: 'pass' },
            C4: { state: 'not-calculated', detail: 'Not calculated - not selected on Page 1' },
          },
          size: { runs: 1, cores: '4C', sizeMm2: 10, eccMm2: 10, lengthM: 40 },
          device: { type: 'MCCB', ratingA: 40, poles: '3P', faultRatingKa: 25 },
          load: { connectedKw: { L1: 7, L2: 7, L3: 6 }, maxDemandKw: 20, standbyKw: null },
          values: {
            ibA: 34,
            inA: 40,
            izA: 57.6,
            vdOwnPct: 1.36,
            vdTotalPct: 2.36,
            ikMaxKa: null,
            ikMinKa: null,
            ipKa: null,
            zsMohm: null,
          },
          trace: [{ step: 'Ib', detail: '20 kW / (sqrt3 x 400 x 0.85)' }],
        },
      ],
    });
    expect(run.results[0]?.checks.C4?.state).toBe('not-calculated');
  });
});
