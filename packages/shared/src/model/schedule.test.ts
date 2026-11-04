import { describe, expect, it } from 'vitest';
import { modelledProject, sampleDb, testCable, testElement } from '../testing.js';
import { loadSummaries } from './loads.js';
import type { ElementResult } from './results.js';
import {
  boardSchedule,
  busbarSchedule,
  exportProblems,
  scheduleLevelOf,
  sldTree,
} from './schedule.js';
import { inputsKey, mergeRun } from './sizing.js';

function network() {
  const p = modelledProject();
  const f = p.building.floors.find((x) => x.code === 'GF')!.id;
  const tx = { ...testElement('transformer', 'tx', f), tag: 'TX-1' };
  const mdb = { ...testElement('mdb', 'mdb', f), tag: 'MDB-1' };
  const smdb = { ...testElement('smdb', 'smdb', f), tag: 'SMDB-1' };
  const db = {
    ...sampleDb(f, 'db-x'),
    tag: 'DB-X',
    loads: [{ method: 'kw' as const, loadType: '1' as const, kwL1: 3, kwL2: 2, kwL3: 1 }],
  };
  p.model.elements = [tx, mdb, smdb, db];
  p.model.cables = [testCable(tx, mdb), testCable(smdb, db)];
  p.model.risers = [{ id: 'r1', lengthM: 20, widthM: 1, fedFromId: 'mdb', feeds: ['smdb'] }];
  return p;
}

describe('#TASK-30 / #TASK-31 schematic tree and panel schedules (Section 14)', () => {
  it('maps board kinds to the Report Library levels', () => {
    expect(scheduleLevelOf('mdb')).toBe('first');
    expect(scheduleLevelOf('mcc')).toBe('second');
    expect(scheduleLevelOf('db')).toBe('floor');
    expect(scheduleLevelOf('transformer')).toBeNull();
  });

  it('builds the tree from the transformer through feeders and riser tap-offs', () => {
    const tree = sldTree(network().model, 'tx')!;
    expect(tree.element.tag).toBe('TX-1');
    const mdb = tree.children[0]!;
    expect(mdb.via?.kind).toBe('feeder');
    const smdb = mdb.children[0]!;
    expect(smdb.via).toEqual({ kind: 'riser', riser: 1 });
    expect(smdb.children[0]!.element.tag).toBe('DB-X');
  });

  it('#TASK-19 carries the load of riser-fed boards up to the MDB and transformer', () => {
    const p = network();
    const s = loadSummaries(p, 0.9);
    expect(s.get('smdb')!.connectedKw).toBe(6);
    expect(s.get('mdb')!.connectedKw).toBe(6);
    expect(s.get('tx')!.connectedKw).toBe(6);
  });

  it('fills a schedule from the model; sizes wait for Cable Size', () => {
    const p = network();
    const s = boardSchedule(p, 'smdb', loadSummaries(p, 0.9), { allowancePct: 0, additionM: 5 })!;
    expect(s).toMatchObject({ connectedTo: 'Riser 1', transformer: 'TX-1', sizesPending: true });
    expect(s.incomers).toEqual([
      expect.objectContaining({
        feeder: 'INCOMER',
        type: 'Tap-off box',
        breakerA: null,
        remarks: 'Tap-off from Riser 1',
      }),
    ]);
    expect(s.ways).toHaveLength(1);
    expect(s.ways[0]).toMatchObject({ feeder: 'DB-X', cores: '4C', type: 'XLPE', sizeMm2: null });
    expect(s.ways[0]!.tclKw).toBe(s.totals.tclKw);
    expect(s.totals.tclKw).toBeGreaterThan(0);
  });

  it('#TASK-31 busbar schedule: riser description, incomer from the MDB, tap-off breakers', () => {
    const p = network();
    const values: ElementResult['values'] = {
      ibA: null,
      inA: null,
      izA: null,
      vdOwnPct: null,
      vdTotalPct: null,
      ikMaxKa: null,
      ikMinKa: null,
      ipKa: null,
      zsMohm: null,
    };
    const res = (elementId: string, patch: Partial<ElementResult>): ElementResult => ({
      elementId,
      status: 'final',
      provisionalReasons: [],
      errors: [],
      sizedBy: null,
      checks: {},
      size: null,
      device: null,
      load: null,
      values,
      trace: [],
      ...patch,
    });
    p.model.results = mergeRun(
      p,
      { kind: 'project' },
      [
        res('r1', { values: { ...values, inA: 630, izA: 800 } }),
        res('smdb', { device: { type: 'MCCB', ratingA: 63, poles: '3P', faultRatingKa: null } }),
      ],
      {
        runId: 'r',
        at: '2026-11-04T08:00:00.000Z',
        engineVersion: '0.1.0',
        inputsKey: inputsKey(p),
      },
    );
    const s = busbarSchedule(p, 'r1', loadSummaries(p, 0.9))!;
    expect(s).toMatchObject({
      kind: 'busbar',
      tag: 'Riser 1',
      description: 'Riser 1 - 800 A TPN+E',
      connectedTo: 'MDB-1',
      transformer: 'TX-1',
      sizesPending: false,
    });
    expect(s.incomers[0]).toMatchObject({ breakerA: 630, cores: 'TPN+E', lengthM: 20 });
    expect(s.ways).toEqual([
      expect.objectContaining({ feeder: 'SMDB-1', wayNo: 'T1', breakerA: 63, type: 'Tap-off box' }),
    ]);
    expect(s.totals.tclKw).toBe(6);
    const board = boardSchedule(p, 'smdb', loadSummaries(p, 0.9), {
      allowancePct: 0,
      additionM: 5,
    });
    expect(board!.incomers[0]!.breakerA).toBe(63);
    expect(exportProblems([s])).toEqual([]);
    // E3101: a blocked tap-off and an out-of-date board stop the export.
    p.model.results = p.model.results.map((r) =>
      r.elementId === 'smdb' ? { ...r, status: 'blocked', errors: ['E2102'] } : r,
    );
    expect(exportProblems([busbarSchedule(p, 'r1', loadSummaries(p, 0.9))!])).toEqual([
      'Riser 1 SMDB-1: blocked E2102',
    ]);
    expect(exportProblems([board!])).toContain('SMDB-1: results out of date or not calculated');
  });

  it('#TASK-31 remarks: ELCB of the fed board; two incomers through both inputs', () => {
    const p = network();
    const f = p.building.floors.find((x) => x.code === 'GF')!.id;
    const db = p.model.elements.find((e) => e.id === 'db-x')!;
    Object.assign(db, { earthLeakage: 'ELCB 30 mA' });
    const len = { allowancePct: 0, additionM: 5 };
    expect(boardSchedule(p, 'smdb', loadSummaries(p, 0.9), len)!.ways[0]!.remarks).toBe(
      'ELCB 30 mA',
    );
    const gen = { ...testElement('generator', 'gen', f), tag: 'GEN-1' };
    const emdb = { ...testElement('mdb', 'emdb', f), tag: 'EMDB-1' };
    p.model.elements.push(gen, emdb);
    const normal = testCable(
      p.model.elements.find((e) => e.id === 'tx')!,
      emdb,
    );
    const standby = {
      ...testCable(gen, emdb),
      id: 'c-gen',
      to: { elementId: 'emdb', port: 'standby' as const },
    };
    p.model.cables.push(standby, normal);
    const s = boardSchedule(p, 'emdb', loadSummaries(p, 0.9), len)!;
    expect(s.incomers.map((r) => [r.feeder, r.remarks])).toEqual([
      ['INCOMER 1', ''],
      ['INCOMER 2', 'Standby from GEN-1'],
    ]);
    expect(s.connectedTo).toBe('TX-1 / GEN-1');
  });
});
