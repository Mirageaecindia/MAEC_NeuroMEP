import { describe, expect, it } from 'vitest';
import { modelledProject, testCable, testElement } from '../testing.js';
import type { ElementResult } from './results.js';
import { formatVd, inputsKey, mergeRun, resultOf } from './sizing.js';

const result = (elementId: string): ElementResult => ({
  elementId,
  status: 'final',
  provisionalReasons: [],
  errors: [],
  sizedBy: 'C1',
  checks: { C1: { state: 'pass' } },
  size: null,
  device: null,
  load: null,
  values: {
    ibA: 10,
    inA: 16,
    izA: 20,
    vdOwnPct: 0.5,
    vdTotalPct: 1,
    ikMaxKa: null,
    ikMinKa: null,
    ipKa: null,
    zsMohm: null,
  },
  trace: [],
});

/** DB fed from an MDB on the same floor. */
function network() {
  const p = modelledProject();
  const db = p.model.elements[0]!;
  const mdb = testElement('mdb', 'mdb', db.floorId);
  p.model.elements.push(mdb);
  p.model.cables.push(testCable(mdb, db));
  return p;
}

function run(p: ReturnType<typeof network>, runId = 'run-1') {
  return { runId, at: '2026-11-03T10:00:00.000Z', engineVersion: '0.1.0', inputsKey: inputsKey(p) };
}

describe('#TASK-16 Cable Size results and Out of date (FR-18, FR-21, FR-36)', () => {
  it('keeps the results of the items in the scope: selected item, floor or project', () => {
    const p = network();
    const all = [...p.model.elements, ...p.model.cables].map((x) => result(x.id));
    const db = p.model.elements.find((e) => e.kind === 'db')!;
    const one = mergeRun(p, { kind: 'element', id: db.id }, all, run(p));
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ elementId: db.id, runId: 'run-1', engineVersion: '0.1.0' });
    const floor = mergeRun(p, { kind: 'floor', floorId: db.floorId }, all, run(p));
    expect(floor.length).toBeGreaterThan(1);
    const project = mergeRun(p, { kind: 'project' }, all, run(p));
    expect(project).toHaveLength(
      p.model.elements.filter((e) => e.discipline === 'electrical').length + p.model.cables.length,
    );
  });

  it('replaces earlier results of the scope, keeps the others and drops removed items', () => {
    const p = network();
    const [a, b] = p.model.elements.filter((e) => e.discipline === 'electrical');
    p.model.results = mergeRun(p, { kind: 'project' }, [result(a!.id), result(b!.id)], run(p));
    const again = mergeRun(p, { kind: 'element', id: a!.id }, [result(a!.id)], run(p, 'run-2'));
    expect(again.find((r) => r.elementId === a!.id)?.runId).toBe('run-2');
    expect(again.find((r) => r.elementId === b!.id)?.runId).toBe('run-1');
    p.model.elements = p.model.elements.filter((e) => e.id !== b!.id);
    expect(mergeRun(p, { kind: 'project' }, [], run(p)).map((r) => r.elementId)).toEqual([a!.id]);
  });

  it('is Out of date after any network or set-up change, not after a tag or a move', () => {
    const p = network();
    const db = p.model.elements.find((e) => e.kind === 'db')!;
    p.model.results = mergeRun(p, { kind: 'project' }, [result(db.id)], run(p));
    expect(resultOf(p, db.id)?.outOfDate).toBe(false);
    Object.assign(db, { tag: 'DB-X', position: { x: 9, y: 9 }, version: db.version + 1 });
    expect(resultOf(p, db.id)?.outOfDate).toBe(false);
    // A change on another component (here the MDB withstand) affects the whole network.
    const other = p.model.elements.find((e) => e.id !== db.id)!;
    Object.assign(other, { icwKa: 50 });
    expect(resultOf(p, db.id)?.outOfDate).toBe(true);
  });

  it('is Out of date after a change of site conditions or calculation set-up', () => {
    const p = network();
    const db = p.model.elements.find((e) => e.kind === 'db')!;
    p.model.results = mergeRun(p, { kind: 'project' }, [result(db.id)], run(p));
    p.site.ambientAirC = { value: 48, source: 'user' };
    expect(resultOf(p, db.id)?.outOfDate).toBe(true);
    const q = network();
    q.model.results = mergeRun(q, { kind: 'project' }, [result(db.id)], run(q));
    q.calculation.checks.shortCircuit = !q.calculation.checks.shortCircuit;
    expect(resultOf(q, db.id)?.outOfDate).toBe(true);
  });

  it('formats voltage drop to 2 decimals', () => {
    expect(formatVd(1.2345)).toBe('1.23 %');
    expect(formatVd(null)).toBe('-');
  });
});
