import { describe, expect, it } from 'vitest';
import { modelledProject } from '../testing.js';
import { formatVd, MOCK_ENGINE, mockRun, resultOf } from './sizing.js';

const RUN = { runId: 'run-1', at: '2026-11-01T10:00:00.000Z' };

describe('#TASK-16 Cable Size results and Out of date (FR-18, FR-21, FR-36)', () => {
  it('runs on the selected item, a floor or the whole project, with placeholder results', () => {
    const p = modelledProject();
    const db = p.model.elements.find((e) => e.kind === 'db')!;
    const one = mockRun(p, { kind: 'element', id: db.id }, RUN);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({
      elementId: db.id,
      status: 'provisional',
      engineVersion: MOCK_ENGINE,
      size: null,
      values: { vdTotalPct: null },
    });
    const floor = mockRun(p, { kind: 'floor', floorId: db.floorId }, RUN);
    expect(floor.length).toBeGreaterThanOrEqual(1);
    expect(floor.every((r) => r.runId === 'run-1')).toBe(true);
    const all = mockRun(p, { kind: 'project' }, RUN);
    expect(all.length).toBe(
      p.model.elements.filter((e) => e.discipline === 'electrical').length + p.model.cables.length,
    );
  });

  it('shows unticked optional checks as not selected on Page 1 (D-08)', () => {
    const p = modelledProject();
    p.calculation.checks.letThroughEnergy = false;
    const [r] = mockRun(p, { kind: 'element', id: p.model.elements[0]!.id }, RUN);
    expect(r!.checks.C4?.detail).toBe('Not calculated - not selected on Page 1');
    expect(r!.checks.C1?.detail).toMatch(/Mock run/);
  });

  it('is Out of date after an input changes, not after a tag or a move', () => {
    const p = modelledProject();
    const db = p.model.elements.find((e) => e.kind === 'db')!;
    p.model.results = mockRun(p, { kind: 'project' }, RUN);
    expect(resultOf(p, db.id)?.outOfDate).toBe(false);
    Object.assign(db, { tag: 'DB-X', position: { x: 9, y: 9 }, version: db.version + 1 });
    expect(resultOf(p, db.id)?.outOfDate).toBe(false);
    p.calculation.checks.shortCircuit = !p.calculation.checks.shortCircuit;
    expect(resultOf(p, db.id)?.outOfDate).toBe(true);
  });

  it('formats voltage drop to 2 decimals', () => {
    expect(formatVd(1.2345)).toBe('1.23 %');
    expect(formatVd(null)).toBe('-');
  });
});
