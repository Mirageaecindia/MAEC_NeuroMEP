import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../project/factory.js';
import { ProjectSchema } from '../project/schema.js';
import { FIXED_NOW } from '../testing.js';
import type { Cable, CableConstruction } from './cable.js';
import type { Element } from './elements.js';
import { isPlaceable, libraryItem, placeElement } from './library.js';
import {
  riserBoards,
  riserOf,
  riserRows,
  riserSources,
  setBoardRiser,
  setRiser,
  sourceConnected,
  withoutElements,
} from './riser.js';
import { topologyCheck } from './topology.js';
import { drawCable, fedFrom } from './wiring.js';

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

function el(key: string, id: string, floorId = 'gf'): Element {
  const item = libraryItem(key)!;
  if (!isPlaceable(item)) throw new Error(key);
  const e = placeElement(item, {
    id,
    floorId,
    floorCode: 'GF',
    position: { x: 0, y: 0 },
    taken: [],
  });
  return { ...e, tag: id };
}
const cable = (from: Element, to: Element): Cable =>
  drawCable({
    id: `c-${to.id}`,
    cables: [],
    from: { element: from, port: 'out' },
    to: { element: to, port: 'in' },
    route: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    floorCode: 'GF',
    construction,
  });

const tx = el('transformer', 'TX');
const mdb = el('mdb', 'MDB');
const smdb1 = el('smdb', 'SMDB-1', 'f1');
const db1 = el('db', 'DB-1', 'f1');
const db1b = el('db', 'DB-1B', 'f1');
const network = (risers = riserRows([])) => ({
  elements: [tx, mdb, smdb1, db1, db1b],
  cables: [cable(tx, mdb), cable(smdb1, db1)],
  risers,
});

describe('#TASK-17 Riser Design (FR-20, A-05)', () => {
  it('shows three rows, keeping the stored risers', () => {
    expect(riserRows([]).map((r) => r.id)).toEqual(['riser-1', 'riser-2', 'riser-3']);
    const rows = setRiser([], 'riser-1', { lengthM: 26, widthM: 0.4 });
    expect(rows[0]).toMatchObject({ id: 'riser-1', lengthM: 26, widthM: 0.4 });
    expect(rows).toHaveLength(3);
  });

  it('loads projects stored before risers existed, or without their connections', () => {
    const p = createEmptyProject({ id: 'p', userId: 'u', now: FIXED_NOW });
    const { risers: _r, ...oldModel } = p.model;
    expect(ProjectSchema.parse({ ...p, model: oldModel }).model.risers).toEqual([]);
    const typedOnly = {
      ...p,
      model: { ...p.model, risers: [{ id: 'riser-1', lengthM: 9, widthM: null }] },
    };
    expect(ProjectSchema.parse(typedOnly).model.risers[0]).toMatchObject({
      fedFromId: null,
      feeds: [],
    });
  });

  it('refuses a length of 0 or less', () => {
    const p = createEmptyProject({ id: 'p', userId: 'u', now: FIXED_NOW });
    p.model.risers = riserRows([]).map((r) => ({ ...r, lengthM: 0 }));
    expect(ProjectSchema.safeParse(p).success).toBe(false);
  });
});

describe('#TASK-18 riser connections (FR-20, Section 3)', () => {
  it('is fed from a transformer or main board and feeds boards not fed by a cable', () => {
    expect(riserSources(network()).map((e) => e.id)).toEqual(['TX', 'MDB']);
    // DB-1 is fed by a cable from SMDB-1, so only SMDB-1 and DB-1B take a tap-off.
    expect(riserBoards(network(), 'f1').map((e) => e.id)).toEqual(['SMDB-1', 'DB-1B']);
  });

  it('feeds a board from one riser at a time', () => {
    let risers = setBoardRiser([], 'SMDB-1', 'riser-1');
    risers = setBoardRiser(risers, 'SMDB-1', 'riser-2');
    expect(riserOf(risers, 'SMDB-1')?.id).toBe('riser-2');
    expect(risers[0]!.feeds).toEqual([]);
    expect(riserOf(setBoardRiser(risers, 'SMDB-1', null), 'SMDB-1')).toBeUndefined();
  });

  it('shows the riser as Fed From and refuses a second supply by cable (E1401)', () => {
    const m = network(setBoardRiser([], 'SMDB-1', 'riser-2'));
    expect(fedFrom(smdb1, m)).toBe('Riser 2');
    const check = topologyCheck(m, mdb, smdb1, 'in');
    expect(check).toMatchObject({ ok: false, code: 'E1401' });
  });

  it('counts as connected to the source once a riser leads back to a transformer (A-07)', () => {
    expect(sourceConnected(network())).toBe(false);
    expect(sourceConnected(network(setRiser([], 'riser-1', { fedFromId: 'MDB' })))).toBe(true);
    expect(sourceConnected(network(setRiser([], 'riser-1', { fedFromId: 'TX' })))).toBe(true);
    const lone = { ...network(setRiser([], 'riser-1', { fedFromId: 'MDB' })), cables: [] };
    expect(sourceConnected(lone)).toBe(false);
  });

  it('forgets removed components', () => {
    let risers = setRiser([], 'riser-1', { fedFromId: 'MDB' });
    risers = setBoardRiser(risers, 'SMDB-1', 'riser-1');
    const after = withoutElements(risers, new Set(['MDB', 'SMDB-1']));
    expect(after[0]).toMatchObject({ fedFromId: null, feeds: [] });
  });
});
