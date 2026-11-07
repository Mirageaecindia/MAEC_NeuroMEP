import { describe, expect, it } from 'vitest';
import { completeProject, sequentialIds, testCable, testElement } from '../testing.js';
import { copyComponents, floorComponents } from './copy.js';

/** An SMDB feeding a DB and an isolator with its pump (equipment link) on the Ground Floor. */
function building() {
  const p = completeProject();
  const gf = p.building.floors.find((f) => f.code === 'GF')!;
  const first = p.building.floors.find((f) => f.code === '1')!;
  const at = (e: ReturnType<typeof testElement>, x: number, tag: string) => ({
    ...e,
    floorId: gf.id,
    tag,
    position: { x, y: 2 },
  });
  const smdb = at(testElement('smdb', 'smdb'), 1, 'SMDB-GF-01');
  const db = at(testElement('db', 'db'), 5, 'DB-GF-01');
  const iso = at(testElement('isolator-tp', 'iso'), 8, 'ISO-GF-01');
  const pump = { ...at(testElement('phe-equipment', 'pump'), 9, 'PHE-GF-01'), fedFromId: 'iso' };
  const feed = { ...testCable(smdb, db), floorId: gf.id };
  p.model.elements = [smdb, db, iso, pump];
  p.model.cables = [feed];
  return { p, gf, first, smdb, db, iso, pump, feed };
}

describe('copy / paste and Replicate floor (user request 7 Nov 2026)', () => {
  it('copies components to another floor with the next tags of that floor and the feeder between them', () => {
    const { p, first } = building();
    const r = copyComponents(p, {
      ids: ['smdb', 'db'],
      targetFloorId: first.id,
      newId: sequentialIds('n'),
    });
    expect(r.elements.map((e) => e.tag)).toEqual(['SMDB-1-01', 'DB-1-01']);
    expect(r.elements.every((e) => e.floorId === first.id && e.version === 0)).toBe(true);
    expect(r.elements[0]!.position).toEqual({ x: 1, y: 2 });
    expect(r.cables).toHaveLength(1);
    const [c] = r.cables;
    expect(c!.from.elementId).toBe(r.elements[0]!.id);
    expect(c!.to.elementId).toBe(r.elements[1]!.id);
    expect(c!.floorId).toBe(first.id);
    expect(c!.tag).toMatch(/^F1-/);
    expect(c!.construction).toEqual(p.model.cables[0]!.construction);
  });

  it('keeps the engineering properties and loads, with a new id', () => {
    const { p, first, db } = building();
    const withLoad = { ...db, description: 'Office DB', poles: 'TPN' as const };
    p.model.elements = p.model.elements.map((e) => (e.id === 'db' ? withLoad : e));
    const [copy] = copyComponents(p, {
      ids: ['db'],
      targetFloorId: first.id,
      newId: sequentialIds('n'),
    }).elements;
    const { id, tag, floorId, version, ...rest } = copy!;
    const { id: _i, tag: _t, floorId: _f, version: _v, ...original } = withLoad;
    expect(rest).toEqual(original);
    expect(id).not.toBe('db');
  });

  it('pastes on the same floor with an offset and fresh tags; a feeder to a board outside the copy is not copied', () => {
    const { p, gf } = building();
    const r = copyComponents(p, {
      ids: ['db'],
      targetFloorId: gf.id,
      offset: { x: 1, y: 1 },
      newId: sequentialIds('n'),
    });
    expect(r.elements[0]!.tag).toBe('DB-GF-02');
    expect(r.elements[0]!.position).toEqual({ x: 6, y: 3 });
    expect(r.cables).toEqual([]);
  });

  it('keeps an equipment link inside the copy and drops a link to an isolator outside it', () => {
    const { p, first } = building();
    const both = copyComponents(p, {
      ids: ['iso', 'pump'],
      targetFloorId: first.id,
      newId: sequentialIds('n'),
    }).elements;
    const pump = both.find((e) => e.kind === 'equipment')!;
    expect('fedFromId' in pump && pump.fedFromId).toBe(
      both.find((e) => e.kind !== 'equipment')!.id,
    );
    const alone = copyComponents(p, {
      ids: ['pump'],
      targetFloorId: first.id,
      newId: sequentialIds('m'),
    }).elements[0]!;
    expect('fedFromId' in alone && alone.fedFromId).toBe(null);
  });

  it('lists the components of a floor for the given layers', () => {
    const { p, gf } = building();
    expect(floorComponents(p, gf.id, ['electrical']).map((e) => e.id)).toEqual([
      'smdb',
      'db',
      'iso',
    ]);
    expect(floorComponents(p, gf.id, ['phe']).map((e) => e.id)).toEqual(['pump']);
  });
});
