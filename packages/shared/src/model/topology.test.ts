import { describe, expect, it } from 'vitest';
import type { Cable, CableConstruction } from './cable.js';
import type { Element } from './elements.js';
import { isPlaceable, libraryItem, placeElement } from './library.js';
import { topologyCheck, unusualConnections, usualConnections } from './topology.js';
import { drawCable, type Port } from './wiring.js';

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
const route = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
];

function el(key: string, id: string): Element {
  const item = libraryItem(key)!;
  if (!isPlaceable(item)) throw new Error(key);
  return placeElement(item, {
    id,
    floorId: 'f',
    floorCode: 'GF',
    position: { x: 0, y: 0 },
    taken: [id],
  });
}
/** Connects two elements without the topology check (to build a starting model). */
function link(cables: Cable[], from: Element, to: Element, port: Port = 'in'): Cable[] {
  const c = drawCable({
    id: `c${cables.length + 1}`,
    cables,
    from: { element: from, port: 'out' },
    to: { element: to, port },
    route,
    floorCode: 'GF',
    construction,
  });
  return [...cables, c];
}
const check = (cables: Cable[], from: Element, to: Element, port: Port = 'in') =>
  topologyCheck({ cables }, from, to, port);

describe('#TASK-14 connections: anything goes but a loop (A-20, user decision 7 Nov 2026)', () => {
  const eb = el('eb-utility', 'eb');
  const tx = el('transformer', 'tx');
  const mdb = el('mdb', 'mdb');
  const emdb = { ...el('mdb', 'emdb'), kind: 'emdb', tag: 'EMDB-GF-01' } as Element;
  const lv = el('lv-panel', 'lv');
  const smdb = el('smdb', 'smdb');
  const db = el('db', 'db');
  const gen = el('generator', 'gen');
  const ats = el('ats', 'ats');

  it('allows any component to feed any other, in either direction', () => {
    for (const [from, to] of [
      [eb, tx],
      [tx, db],
      [smdb, mdb],
      [db, smdb],
      [gen, emdb],
      [lv, emdb],
      [mdb, gen],
    ] as const) {
      expect(check([], from, to)).toEqual({ ok: true });
    }
    expect(check([], gen, ats, 'normal')).toEqual({ ok: true });
  });

  it('allows several supplies and any number of ways', () => {
    const one = link([], mdb, smdb);
    expect(check(one, el('mdb', 'mdb2'), smdb)).toEqual({ ok: true });
    let cables: Cable[] = [];
    for (let i = 0; i < 30; i++) cables = link(cables, smdb, el('db', `d${i}`));
    expect(check(cables, smdb, el('db', 'd30'))).toEqual({ ok: true });
  });

  it('refuses only a loop (E1401), which Cable Size cannot calculate', () => {
    const viaAts = link([], mdb, ats, 'normal');
    expect(check(viaAts, ats, mdb)).toMatchObject({ ok: false, code: 'E1401' });
    expect(check([], mdb, mdb)).toMatchObject({ ok: false, code: 'E1401' });
  });

  it('describes the usual connections and notes unusual ones without refusing them', () => {
    expect(usualConnections('emdb').fedFrom).toEqual(
      expect.arrayContaining(['transformer', 'generator', 'lv-panel']),
    );
    expect(usualConnections('smdb').feeds).toEqual(expect.arrayContaining(['db']));
    const cables = link(link([], tx, db), smdb, db);
    const notes = unusualConnections({ elements: [tx, smdb, db], cables }, db);
    expect(notes).toEqual([
      `Fed from ${tx.tag}: a Transformer does not usually feed a DB.`,
      `2 supplies (feeders): each one is sized for the whole load of ${db.tag}.`,
    ]);
    expect(unusualConnections({ elements: [lv, emdb], cables: link([], lv, emdb) }, emdb)).toEqual(
      [],
    );
  });
});
