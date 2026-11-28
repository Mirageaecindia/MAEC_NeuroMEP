import { describe, expect, it } from 'vitest';
import { completeProject, sequentialIds, testCable, testElement } from '../testing.js';
import {
  cloneComponents,
  copyComponents,
  downstreamOf,
  floorComponents,
  sheetMapping,
} from './copy.js';

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

describe('same place on the sheet (user request 8 Nov 2026)', () => {
  const plan = (widthPt: number, heightPt: number, metresPerUnit: number) => ({
    plan: {
      kind: 'pdf' as const,
      fileId: 'f',
      fileName: 'p.pdf',
      uploadedAt: '2026-11-08T00:00:00.000Z',
      uploadedBy: 'u',
      page: { widthPt, heightPt },
      calibration: {
        method: 'drawing-scale' as const,
        scaleDenominator: 100,
        sheetSize: 'A1' as const,
        metresPerUnit,
        calibratedAt: '2026-11-08T00:00:00.000Z',
        calibratedBy: 'u',
      },
    },
  });

  it('keeps the position on the page when the target plan is calibrated differently', () => {
    // (10 m, 5 m) on a plan at 0.05 m per unit = (200, 100) on the page.
    const map = sheetMapping(plan(1000, 700, 0.05), plan(1000, 700, 0.1))!;
    expect(map({ x: 10, y: 5 })).toEqual({ x: 20, y: 10 }); // (200, 100) at 0.1 m per unit
    // A bigger sheet of the same drawing: the same fraction across and down.
    const big = sheetMapping(plan(1000, 700, 0.05), plan(2000, 1400, 0.05))!;
    expect(big({ x: 10, y: 5 })).toEqual({ x: 20, y: 10 }); // (400, 200)
    expect(sheetMapping(plan(1000, 700, 0.05), { plan: null })).toBeNull();
  });

  it('replicated components and their feeders land on the same sheet position', () => {
    const { p, first } = building();
    const map = sheetMapping(plan(1000, 700, 0.05), plan(1000, 700, 0.1))!;
    const r = copyComponents(p, {
      ids: ['smdb', 'db'],
      targetFloorId: first.id,
      map,
      newId: sequentialIds('n'),
    });
    expect(r.elements.map((e) => e.position)).toEqual([
      { x: 2, y: 4 },
      { x: 10, y: 4 },
    ]);
    expect(r.cables[0]!.route[0]).toEqual(map(p.model.cables[0]!.route[0]!));
  });
});

describe('Clone: a component and its downstream onto a floor (user request 28 Nov 2026)', () => {
  /** MDB-GF-01 > SMDB-GF-01 > DB-GF-01 and ISO-GF-01 (pump); a DB on floor 1 fed from the SMDB. */
  function tree() {
    const b = building();
    const mdb = {
      ...testElement('mdb', 'mdb'),
      floorId: b.gf.id,
      tag: 'MDB-GF-01',
      position: { x: 0, y: 0 },
    };
    const up = { ...b.first, id: b.first.id };
    const db1 = {
      ...testElement('db', 'db-1'),
      floorId: up.id,
      tag: 'DB-1-01',
      position: { x: 3, y: 3 },
    };
    const toSmdb = { ...testCable(mdb, b.smdb), floorId: b.gf.id };
    const toIso = { ...testCable(b.smdb, b.iso), floorId: b.gf.id };
    const between = { ...testCable(b.smdb, db1), floorId: b.gf.id, manualLengthM: 12 };
    b.p.model.elements.push(mdb, db1);
    b.p.model.cables.push(toSmdb, toIso, between);
    return { ...b, mdb, db1, between };
  }

  it('takes the component, every level below it (any floor) and the linked equipment', () => {
    const { p } = tree();
    expect(downstreamOf(p.model, 'smdb').sort()).toEqual(['db', 'db-1', 'iso', 'pump', 'smdb']);
    expect(downstreamOf(p.model, 'db')).toEqual(['db']);
  });

  it('copies them onto the chosen floor with new ids, the floor tags and the feeders between them', () => {
    const { p, first } = tree();
    const r = cloneComponents(p, {
      rootId: 'smdb',
      targetFloorId: first.id,
      layers: ['electrical', 'mechanical', 'phe'],
      withFeeders: true,
      newId: sequentialIds('c'),
    });
    expect(r.elements.map((e) => e.tag).sort()).toEqual([
      'DB-1-02',
      'DB-1-03',
      'ISO-1-01',
      'PHE-1-01',
      'SMDB-1-01',
    ]);
    expect(
      r.elements.every(
        (e) => e.floorId === first.id && !['smdb', 'db', 'db-1', 'iso', 'pump'].includes(e.id),
      ),
    ).toBe(true);
    // The pump stays linked to the cloned isolator; the cloned SMDB has no supply (nothing above copied).
    const iso = r.elements.find((e) => e.tag === 'ISO-1-01')!;
    expect(r.elements.find((e) => e.tag === 'PHE-1-01')).toMatchObject({ fedFromId: iso.id });
    expect(r.cables).toHaveLength(3);
    expect(
      r.cables.some((c) => c.to.elementId === r.elements.find((e) => e.tag === 'SMDB-1-01')!.id),
    ).toBe(false);
    // The feeder that ran between floors is now a plan feeder on the target floor.
    const db1 = r.elements.find((e) => e.position.x === 3 && e.position.y === 3)!;
    const was = r.cables.find((c) => c.to.elementId === db1.id)!;
    expect(was.manualLengthM).toBeUndefined();
    expect(was.route).toEqual([
      r.elements.find((e) => e.tag === 'SMDB-1-01')!.position,
      db1.position,
    ]);
  });

  it('copies only the layers the user may edit; feeders only with the electrical layer', () => {
    const { p, first } = tree();
    const r = cloneComponents(p, {
      rootId: 'smdb',
      targetFloorId: first.id,
      layers: ['electrical'],
      withFeeders: false,
      newId: sequentialIds('c'),
    });
    expect(r.elements.map((e) => e.discipline).every((d) => d === 'electrical')).toBe(true);
    expect(r.skipped).toBe(1);
    expect(r.cables).toEqual([]);
  });

  it('onto its own floor the clone lands 2 m down and right, with the next free tags', () => {
    const { p, gf } = tree();
    const r = cloneComponents(p, {
      rootId: 'db',
      targetFloorId: gf.id,
      layers: ['electrical'],
      withFeeders: true,
      newId: sequentialIds('c'),
    });
    expect(r.elements).toHaveLength(1);
    expect(r.elements[0]).toMatchObject({ tag: 'DB-GF-02', position: { x: 7, y: 4 } });
  });
});
