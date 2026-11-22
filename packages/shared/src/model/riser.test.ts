import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../project/factory.js';
import { ProjectSchema } from '../project/schema.js';
import { FIXED_NOW, testCable, testElement } from '../testing.js';
import type { Element } from './elements.js';
import {
  addRiser,
  distributionOf,
  removeRiser,
  riserConnected,
  riserInUse,
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
import { fedFrom } from './wiring.js';

const el = testElement;
const cable = (from: Element, to: Element) => testCable(from, to);

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
  it('adds and deletes busbar risers; rows are the stored risers (22 Nov 2026)', () => {
    expect(riserRows([])).toEqual([]);
    let rows = addRiser(addRiser([]));
    expect(rows.map((r) => r.id)).toEqual(['riser-1', 'riser-2']);
    rows = setRiser(rows, 'riser-1', { lengthM: 26, widthM: 0.4 });
    expect(rows[0]).toMatchObject({ id: 'riser-1', lengthM: 26, widthM: 0.4 });
    rows = removeRiser(rows, 'riser-1');
    expect(rows.map((r) => r.id)).toEqual(['riser-2']);
    // A new riser never takes an id still in use.
    expect(addRiser(rows).map((r) => r.id)).toEqual(['riser-2', 'riser-3']);
  });

  it('tells a riser in use and the way power goes between floors', () => {
    const empty = addRiser([])[0]!;
    expect(riserInUse(empty)).toBe(false);
    expect(riserConnected({ ...empty, lengthM: 9 })).toBe(false);
    expect(riserConnected({ ...empty, feeds: ['DB-1'] })).toBe(true);
    expect(distributionOf({ risers: [empty] })).toBe('feeder');
    expect(distributionOf({ risers: [{ ...empty, lengthM: 9 }] })).toBe('busbar-riser');
    expect(distributionOf({ risers: [], distribution: 'busbar-riser' })).toBe('busbar-riser');
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
    p.model.risers = addRiser([]).map((r) => ({ ...r, lengthM: 0 }));
    expect(ProjectSchema.safeParse(p).success).toBe(false);
  });
});

describe('#TASK-18 riser connections (FR-20, Section 3)', () => {
  it('may be fed from any electrical component and lists every one of a floor (A-20)', () => {
    expect(riserSources(network()).map((e) => e.id)).toEqual(network().elements.map((e) => e.id));
    expect(riserBoards(network(), 'f1').map((e) => e.id)).toEqual(['SMDB-1', 'DB-1', 'DB-1B']);
  });

  it('feeds a board from one riser at a time', () => {
    let risers = setBoardRiser([], 'SMDB-1', 'riser-1');
    risers = setBoardRiser(risers, 'SMDB-1', 'riser-2');
    expect(riserOf(risers, 'SMDB-1')?.id).toBe('riser-2');
    expect(risers[0]!.feeds).toEqual([]);
    expect(riserOf(setBoardRiser(risers, 'SMDB-1', null), 'SMDB-1')).toBeUndefined();
  });

  it('shows the riser as Fed From; a feeder as well is allowed (A-20)', () => {
    const m = network(setBoardRiser(addRiser(addRiser([])), 'SMDB-1', 'riser-2'));
    expect(fedFrom(smdb1, m)).toBe('Riser 2');
    expect(topologyCheck(m, mdb, smdb1, 'in')).toEqual({ ok: true });
  });

  it('counts as connected once a transformer feeds something - a riser is optional (A-22)', () => {
    expect(sourceConnected(network())).toBe(true); // TX feeds the MDB by a feeder
    const noFeeder = { ...network(), cables: [] };
    expect(sourceConnected(noFeeder)).toBe(false);
    expect(
      sourceConnected({ ...noFeeder, risers: setRiser([], 'riser-1', { fedFromId: 'TX' }) }),
    ).toBe(true);
    // A riser from a board that has no feeder from the transformer is not enough.
    expect(
      sourceConnected({ ...noFeeder, risers: setRiser([], 'riser-1', { fedFromId: 'MDB' }) }),
    ).toBe(false);
  });

  it('forgets removed components', () => {
    let risers = setRiser([], 'riser-1', { fedFromId: 'MDB' });
    risers = setBoardRiser(risers, 'SMDB-1', 'riser-1');
    const after = withoutElements(risers, new Set(['MDB', 'SMDB-1']));
    expect(after[0]).toMatchObject({ fedFromId: null, feeds: [] });
  });
});
