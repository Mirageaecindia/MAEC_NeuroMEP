import { describe, expect, it } from 'vitest';
import { modelledProject, sampleDb, testCable, testElement } from '../testing.js';
import { loadSummaries } from './loads.js';
import { boardSchedule, scheduleLevelOf, sldTree } from './schedule.js';

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
    expect(s.incomer).toMatchObject({ feeder: 'INCOMER', cores: '-', breakerA: null });
    expect(s.ways).toHaveLength(1);
    expect(s.ways[0]).toMatchObject({ feeder: 'DB-X', cores: '4C', type: 'XLPE', sizeMm2: null });
    expect(s.ways[0]!.tclKw).toBe(s.totals.tclKw);
    expect(s.totals.tclKw).toBeGreaterThan(0);
  });
});
