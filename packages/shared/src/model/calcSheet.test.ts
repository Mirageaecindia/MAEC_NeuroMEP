import { describe, expect, it } from 'vitest';
import { modelledProject, sampleDb, testCable, testElement } from '../testing.js';
import { CALC_COLUMNS, calculationSheet } from './calcSheet.js';
import { loadSummaries } from './loads.js';
import type { ElementResult } from './results.js';
import { inputsKey, mergeRun } from './sizing.js';

/** TX-1 > MDB-1 by cable; Riser 1 from MDB-1 to SMDB-1; SMDB-1 > DB-X by cable. */
function network() {
  const p = modelledProject();
  const f = p.building.floors.find((x) => x.code === 'GF')!.id;
  const tx = { ...testElement('transformer', 'tx', f), tag: 'TX-1' };
  const mdb = { ...testElement('mdb', 'mdb', f), tag: 'MDB-1' };
  const smdb = { ...testElement('smdb', 'smdb', f), tag: 'SMDB-1' };
  const db = {
    ...sampleDb(f, 'db-x'),
    tag: 'DB-X',
    loads: [{ method: 'kw' as const, loadType: '1' as const, kwL1: 3, kwL2: 3, kwL3: 3 }],
  };
  p.model.elements = [db, smdb, mdb, tx]; // stored out of order on purpose
  p.model.cables = [
    { ...testCable(smdb, db), tag: 'F1-2' },
    { ...testCable(tx, mdb), tag: 'F1-1' },
  ];
  p.model.risers = [{ id: 'r1', lengthM: 20, widthM: 1, fedFromId: 'mdb', feeds: ['smdb'] }];
  return p;
}

const values: ElementResult['values'] = {
  ibA: 14.4,
  inA: 16,
  izA: 38.2,
  vdOwnPct: 0.512,
  vdTotalPct: 2.4,
  ikMaxKa: 9.87,
  ikMinKa: 4.1,
  ipKa: null,
  zsMohm: 512.3,
};

function result(elementId: string): ElementResult {
  return {
    elementId,
    status: 'final',
    provisionalReasons: [],
    errors: [],
    sizedBy: 'C6',
    checks: { C1: { state: 'pass' }, C2: { state: 'pass' }, C3: { state: 'not-calculated' } },
    size: { runs: 1, cores: '4C', sizeMm2: 4, eccMm2: 4, lengthM: 30.5 },
    device: { type: 'MCB', ratingA: 16, poles: '3P', faultRatingKa: 10 },
    load: { connectedKw: { L1: 3, L2: 3, L3: 3 }, maxDemandKw: 9, standbyKw: null },
    values,
    calc: {
      ibCase: 'three-phase',
      pf: 0.9,
      itA: 44,
      k1: 0.82,
      k2: 1,
      kr: 1,
      k3: 1,
      vuMvAm: 9.5,
      vdOwnV: 2.05,
      vdUpstreamPct: 1.888,
      vdLimitPct: 4,
      busbarA: null,
      lengthM: 30.5,
      loadFactorK: null,
    },
    trace: [],
  };
}

describe('#TASK-31 calculation sheet (WBS 1.7.3, Section 14 "Cable schedule")', () => {
  it('lists cables and risers in network order, from the transformer down', () => {
    const p = network();
    const sheet = calculationSheet(p, loadSummaries(p, 0.9));
    expect(sheet.rows.map((r) => [r.ref, r.kind, r.from, r.to])).toEqual([
      ['F1-1', 'Cable', 'TX-1', 'MDB-1'],
      ['Riser 1', 'Riser', 'MDB-1', 'SMDB-1'],
      ['F1-2', 'Cable', 'SMDB-1', 'DB-X'],
    ]);
    // Before Cable Size: inputs only, waiting for a run.
    expect(sheet.sizesPending).toBe(true);
    expect(sheet.rows[2]).toMatchObject({
      status: 'Not calculated',
      method: 'B - conduit / trunking',
      construction: expect.stringMatching(/^4C Cu XLPE/),
      loadKw: 9,
      C1: '-',
    });
    expect(sheet.rows[1]).toMatchObject({ lengthM: 20, construction: 'Busbar TPN+E (tap-off)' });
  });

  it('shows the working: unit drop, feeder drop and short circuit with the row figures (27 Nov 2026)', () => {
    const p = network();
    const id = p.model.cables[0]!.id;
    const run = { runId: 'run-1', at: '2026-11-27T08:00:00Z', engineVersion: 't' };
    const small = result(id);
    const big: ElementResult = {
      ...small,
      size: { ...small.size!, sizeMm2: 300, runs: 1, lengthM: 15 },
      values: { ...small.values, ibA: 300, ikMaxKa: 22.56 },
      calc: {
        ...small.calc!,
        pf: 0.85,
        vdrMvAm: 0.14,
        vdxMvAm: 0.12,
        vuMvAm: 0.14 * 0.85 + 0.12 * Math.sin(Math.acos(0.85)),
        vdOwnV: ((0.14 * 0.85 + 0.12 * Math.sin(Math.acos(0.85))) * 300 * 15) / 1000,
        rkMohm: (18.32 * 15) / 300,
        xkMohm: 0.09 * 15,
        rktMohm: 1.664,
        xktMohm: 10.103,
      },
    };
    const rowOf = (r: ElementResult) => {
      p.model.results = mergeRun(p, { kind: 'project' }, [r], { ...run, inputsKey: inputsKey(p) });
      return calculationSheet(p, loadSummaries(p, 0.9)).rows.find((x) => x.cableId === id)!;
    };
    const row = rowOf(big);
    expect(row.vuFormula).toBe(
      'Vu = VDr x cos phi + VDx x sin phi = 0.140 x 0.850 + 0.120 x 0.527 = 0.182 mV/A/m',
    );
    expect(row.vdFormula).toBe(
      'Vd = Vu x Ib x L / (1000 x N) = 0.182 x 300.00 x 15.00 / (1000 x 1) = 0.82 V = 0.20 % of 400 V',
    );
    expect(row.scFormula).toContain(
      'Ik"max at the breaker = 400 / (1.732 x sqrt(Rkt² + Xkt²)) = 400 / (1.732 x sqrt(1.664² + 10.103²)) = 400 / (1.732 x 10.239) = 22.56 kA',
    );
    expect(row.scFormula).toContain(
      'Rk = 18.32 x L / (A x N) = 18.32 x 15.00 / (300 x 1) = 0.916 mOhm; Xk = 0.09 x L / N = 0.09 x 15.00 / 1 = 1.350 mOhm',
    );
    // An older result of a 300 mm² cable without VDr / VDx: no table claim, run Cable Size again.
    const old: ElementResult = {
      ...big,
      calc: { ...big.calc!, vdrMvAm: undefined, vdxMvAm: undefined },
    };
    expect(rowOf(old).vuFormula).toMatch(
      /not kept by this older Cable Size result - press Cable Size/,
    );
    // Below 25 mm² the unit drop comes from the table (no VDr / VDx).
    expect(rowOf(small).vuFormula).toMatch(
      /^Vu = 9\.500 mV\/A\/m from the VU table \(4 mm², 3-phase\)/,
    );
  });

  it('takes the figures of the last Cable Size run; checks as short labels', () => {
    const p = network();
    const run = { runId: 'run-1', at: '2026-11-05T08:00:00Z', engineVersion: 't' };
    p.model.results = mergeRun(p, { kind: 'project' }, [result(p.model.cables[0]!.id)], {
      ...run,
      inputsKey: inputsKey(p),
    });
    const row = calculationSheet(p, loadSummaries(p, 0.9)).rows.find((r) => r.ref === 'F1-2')!;
    expect(row).toMatchObject({
      voltageV: 400,
      phases: 3,
      ibA: 14.4,
      inA: 16,
      device: 'MCB',
      icuKa: 10,
      sizeMm2: 4,
      runs: 1,
      eccMm2: 4,
      eccRuns: 1,
      itA: 44,
      izA: 38.2,
      vdOwnV: 2.05,
      vdUpstreamPct: 1.888,
      vdTotalPct: 2.4,
      vdLimitPct: 4,
      ikMaxKa: 9.87,
      C1: 'Pass',
      C3: 'N.C.',
      C4: '-',
      sizedBy: 'C6',
      status: 'Final',
      errors: null,
    });
    expect(row.ktot).toBeCloseTo(0.82, 10);
  });

  it('marks a row Out of date after a change', () => {
    const p = network();
    p.model.results = mergeRun(p, { kind: 'project' }, [result(p.model.cables[0]!.id)], {
      runId: 'run-1',
      at: '2026-11-05T08:00:00Z',
      engineVersion: 't',
      inputsKey: inputsKey(p),
    });
    p.model.risers[0]!.lengthM = 40;
    const sheet = calculationSheet(p, loadSummaries(p, 0.9));
    expect(sheet.rows.find((r) => r.ref === 'F1-2')!.status).toBe('Out of date');
    expect(sheet.sizesPending).toBe(true);
  });

  it('has one column per check C1 - C9 and unique keys', () => {
    const keys = CALC_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => /^C\d$/.test(k))).toEqual([
      'C1',
      'C2',
      'C3',
      'C4',
      'C5',
      'C6',
      'C7',
      'C8',
      'C9',
    ]);
  });
});
