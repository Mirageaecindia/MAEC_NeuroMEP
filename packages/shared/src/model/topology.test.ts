import { describe, expect, it } from 'vitest';
import type { Cable, CableConstruction } from './cable.js';
import type { Element } from './elements.js';
import { isPlaceable, libraryItem, placeElement } from './library.js';
import { topologyCheck } from './topology.js';
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

describe('#TASK-14 topology rules on connect (Section 3, E1401)', () => {
  const eb = el('eb-utility', 'eb');
  const tx = el('transformer', 'tx');
  const mdb = el('mdb', 'mdb');
  const smdb = el('smdb', 'smdb');
  const db = el('db', 'db');
  const gen = el('generator', 'gen');
  const ats = el('ats', 'ats');

  it('follows the supply order source > MDB > SMDB / MCC > DB', () => {
    expect(check([], eb, tx)).toEqual({ ok: true });
    expect(check([], tx, mdb)).toEqual({ ok: true });
    expect(check([], mdb, smdb)).toEqual({ ok: true });
    expect(check([], smdb, db)).toEqual({ ok: true });
    expect(check([], mdb, db)).toEqual({ ok: true });
    const wrong = check([], smdb, mdb);
    expect(wrong).toMatchObject({ ok: false, code: 'E1401' });
    expect(check([], tx, db)).toMatchObject({ ok: false, code: 'E1401' });
  });

  it('feeds an ATS normal input from a transformer and standby from a generator', () => {
    expect(check([], tx, ats, 'normal')).toEqual({ ok: true });
    expect(check([], gen, ats, 'standby')).toEqual({ ok: true });
    expect(check([], gen, ats, 'normal')).toMatchObject({ ok: false });
    const fed = link([], tx, ats, 'normal');
    expect(check(fed, el('transformer', 'tx2'), ats, 'normal')).toMatchObject({
      message: 'The normal input of ATS-GF-01 is already connected.',
    });
  });

  it('allows one supply per board, two incomers on an MDB', () => {
    const one = link([], mdb, smdb);
    expect(check(one, el('mdb', 'mdb2'), smdb)).toMatchObject({
      message: 'SMDB-GF-01 is already fed from another board.',
    });
    const twice = link(link([], tx, mdb), el('transformer', 'tx2'), mdb);
    expect(check(twice, el('transformer', 'tx3'), mdb)).toMatchObject({
      message: 'MDB-GF-01 already has two incomers.',
    });
  });

  it('keeps the network radial', () => {
    // The order rules alone would allow MDB -> ATS (normal) -> back into the same MDB.
    const viaAts = link([], mdb, ats, 'normal');
    expect(check(viaAts, ats, mdb)).toMatchObject({
      ok: false,
      message: 'MDB-GF-01 already feeds ATS-GF-01: the network must stay radial (no loops).',
    });
  });

  it('warns above 18 ways and refuses the 26th', () => {
    let cables: Cable[] = [];
    for (let i = 0; i < 18; i++) cables = link(cables, smdb, el('db', `d${i}`));
    expect(check(cables, smdb, el('db', 'd18'))).toEqual({
      ok: true,
      warning: 'SMDB-GF-01 now has 19 ways (more than 18).',
    });
    for (let i = 18; i < 25; i++) cables = link(cables, smdb, el('db', `d${i}`));
    expect(check(cables, smdb, el('db', 'd25'))).toMatchObject({
      ok: false,
      message: 'SMDB-GF-01 has 25 ways already (maximum).',
    });
  });
});
