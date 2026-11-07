import { describe, expect, it } from 'vitest';
import type { CableConstruction } from './cable.js';
import type { Element } from './elements.js';
import { isPlaceable, libraryItem, placeElement } from './library.js';
import {
  cableLength,
  closeRoute,
  drawBuildingFeeder,
  onPlanOf,
  connectionProblem,
  drawCable,
  fedFrom,
  moveCableEnd,
  nextWay,
  orthogonal,
  portsOf,
} from './wiring.js';

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

function el(key: string, id: string, floorId = 'f-gf'): Element {
  const item = libraryItem(key)!;
  if (!isPlaceable(item)) throw new Error(key);
  return placeElement(item, {
    id,
    floorId,
    floorCode: 'GF',
    position: { x: 0, y: 0 },
    taken: [id],
  });
}

describe('#TASK-13 ports and connections (FR-15)', () => {
  it('gives every component an input and an output (A-20), the ATS two inputs', () => {
    expect(portsOf(el('transformer', 't'))).toEqual(['in', 'out']);
    expect(portsOf(el('generator', 'g'))).toEqual(['in', 'out']);
    expect(portsOf(el('db', 'd'))).toEqual(['in', 'out']);
    expect(portsOf(el('ats', 'a'))).toEqual(['normal', 'standby', 'out']);
  });

  it('runs between two components on the same floor', () => {
    const smdb = { element: el('smdb', 's'), port: 'out' as const };
    expect(connectionProblem(smdb, { element: el('db', 'd'), port: 'in' })).toBeNull();
    expect(connectionProblem(smdb, { element: el('smdb', 's'), port: 'in' })).toMatch(
      /same component/,
    );
    expect(connectionProblem(smdb, { element: el('db', 'd', 'f-1'), port: 'in' })).toMatch(
      /risers/,
    );
  });
});

describe('#TASK-13 routes and length (FR-15, A-05)', () => {
  it('keeps every leg horizontal or vertical and closes on the end with an elbow', () => {
    expect(orthogonal({ x: 0, y: 0 }, { x: 10, y: 2 })).toEqual({ x: 10, y: 0 });
    expect(orthogonal({ x: 0, y: 0 }, { x: 1, y: 8 })).toEqual({ x: 0, y: 8 });
    expect(closeRoute([{ x: 0, y: 0 }], { x: 6, y: 4 })).toEqual([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 4 },
    ]);
  });

  it('keeps the route right-angled when a connected component moves', () => {
    const cable = {
      route: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
      ],
    };
    expect(moveCableEnd(cable, 'to', { x: 12, y: 5 }).route).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 5 },
    ]);
    // The old start becomes the elbow, so the rest of the route stays as drawn.
    expect(moveCableEnd(cable, 'from', { x: 0, y: 2 }).route).toEqual([
      { x: 0, y: 2 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it('adds the fixed 5 m per measured cable (3 Nov 2026), and any percentage', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 9 },
    ];
    expect(cableLength({ route, verticalM: 1 }, { allowancePct: 0, additionM: 5 })).toEqual({
      routedM: 39,
      additionM: 5,
      allowanceM: 0,
      totalM: 44,
    });
    // Older rule (A-05): the cable's 1 m vertical run and 10 %.
    expect(cableLength({ route, verticalM: 1 }, { allowancePct: 10, additionM: null }).totalM).toBe(
      44,
    );
  });
});

describe('#TASK-13 outgoing ways and tags (FR-15, 12.4)', () => {
  it('numbers ways per board, gives phases from the fed board, and tags by hierarchy', () => {
    const mdb = el('mdb', 'mdb');
    const smdb = el('smdb', 'smdb');
    const db = el('db', 'db');
    const singlePhase = { ...el('db', 'db2'), poles: 'SPN' } as Element;
    const route = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ];
    const draw = (cables: ReturnType<typeof drawCable>[], from: Element, to: Element, id: string) =>
      drawCable({
        id,
        cables,
        from: { element: from, port: 'out' },
        to: { element: to, port: 'in' },
        route,
        floorCode: 'GF',
        construction,
      });
    const c1 = draw([], mdb, smdb, 'c1');
    expect(c1).toMatchObject({ circuitRef: '1RYB', tag: 'FGF-1', verticalM: 1 });
    const c2 = draw([c1], smdb, db, 'c2');
    expect(c2).toMatchObject({ circuitRef: '1RYB', tag: 'FGF-1-1' });
    const c3 = draw([c1, c2], smdb, singlePhase, 'c3');
    expect(c3).toMatchObject({ circuitRef: '2R', tag: 'FGF-1-2' });
    expect(nextWay([c1, c3], 'smdb')).toBe(1); // way 1 freed when its cable was removed
    expect(fedFrom(db, { elements: [mdb, smdb, db], cables: [c1, c2] })).toBe(smdb.tag);
    expect(fedFrom(mdb, { elements: [mdb], cables: [c1] })).toBeNull();
  });
});

describe('feeders drawn in the Building tab (user request 8 Nov 2026)', () => {
  const construction = {
    cores: '4C' as const,
    conductor: 'Cu' as const,
    insulation: 'XLPE' as const,
    armour: 'SWA' as const,
    sheath: 'PVC' as const,
    voltageGrade: '600/1000 V' as const,
    method: 'B' as const,
    trays: null,
    depthM: null,
    separation: null,
    groupedCircuits: null,
  };

  it('joins components on two floors with the typed length, tagged on the source floor', () => {
    const mdb = el('mdb', 'm');
    const smdb = el('smdb', 's', 'f-1');
    const c = drawBuildingFeeder({
      id: 'c1',
      cables: [],
      from: mdb,
      to: smdb,
      lengthM: 35,
      floorCode: 'GF',
      construction,
    });
    expect(c).toMatchObject({ manualLengthM: 35, tag: 'FGF-1', circuitRef: '1RYB' });
    expect(cableLength(c, { allowancePct: 10, additionM: 5 })).toEqual({
      routedM: 0,
      additionM: 0,
      allowanceM: 0,
      totalM: 35,
    });
    // Not drawn on either floor plan: it belongs to the Building tab.
    expect(onPlanOf(c, [mdb, smdb], mdb.floorId)).toBe(false);
    expect(onPlanOf(c, [mdb, smdb], 'f-1')).toBe(false);
  });

  it('feeds an ATS normal input first, then standby', () => {
    const ats = el('ats', 'a', 'f-1');
    const first = drawBuildingFeeder({
      id: 'c1',
      cables: [],
      from: el('transformer', 't'),
      to: ats,
      lengthM: 20,
      floorCode: 'GF',
      construction,
    });
    const second = drawBuildingFeeder({
      id: 'c2',
      cables: [first],
      from: el('generator', 'g'),
      to: ats,
      lengthM: 30,
      floorCode: 'GF',
      construction,
    });
    expect([first.to.port, second.to.port]).toEqual(['normal', 'standby']);
  });
});
