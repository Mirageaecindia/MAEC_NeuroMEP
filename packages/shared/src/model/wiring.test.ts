import { describe, expect, it } from 'vitest';
import type { CableConstruction } from './cable.js';
import type { Element } from './elements.js';
import { isPlaceable, libraryItem, placeElement } from './library.js';
import {
  cableLength,
  closeRoute,
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
  it('gives supplies only an output, terminal boards only an input, the ATS two inputs', () => {
    expect(portsOf(el('transformer', 't'))).toEqual(['in', 'out']);
    expect(portsOf(el('generator', 'g'))).toEqual(['out']);
    expect(portsOf(el('db', 'd'))).toEqual(['in']);
    expect(portsOf(el('ats', 'a'))).toEqual(['normal', 'standby', 'out']);
  });

  it('runs from an outgoing to an incoming port on the same floor only', () => {
    const smdb = { element: el('smdb', 's'), port: 'out' as const };
    expect(connectionProblem(smdb, { element: el('db', 'd'), port: 'in' })).toBeNull();
    expect(connectionProblem(smdb, { element: el('smdb', 's'), port: 'in' })).toMatch(
      /same component/,
    );
    expect(
      connectionProblem({ ...smdb, port: 'in' }, { element: el('db', 'd'), port: 'in' }),
    ).toMatch(/outgoing port/);
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

  it('adds 1 m vertical and the allowance to the routed length', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 9 },
    ];
    expect(cableLength({ route, verticalM: 1 }, 10)).toEqual({
      routedM: 39,
      verticalM: 1,
      allowanceM: 4,
      totalM: 44,
    });
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
