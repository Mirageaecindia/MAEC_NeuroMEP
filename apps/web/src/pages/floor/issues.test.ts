import { inputsKey, StoredResultSchema, type Element } from '@neuromep/shared';
import { completeProject, sampleDb, testCable, testElement } from '@neuromep/shared/testing';
import { describe, expect, it } from 'vitest';
import { issuesInScope, panelIssues } from './issues';

describe('right panel issues (18 Nov 2026)', () => {
  it('a blocked feeder says exactly what is missing, e.g. the grouped circuits (E2102)', () => {
    const p = completeProject();
    const f = p.building.floors[0]!.id;
    const tx = { ...testElement('transformer', 'tx', f), tag: 'TX-1' } as Element;
    const db = { ...sampleDb(f, 'db'), tag: 'DB-1' } as Element;
    const cable = { ...testCable(tx, db), tag: 'F-01' };
    p.model.elements = [tx, db];
    p.model.cables = [cable];
    // The engine's result for a tray cable without its grouped circuits (as Cable Size stores it).
    p.model.results = [
      StoredResultSchema.parse({
        elementId: cable.id,
        status: 'blocked',
        provisionalReasons: [],
        errors: ['E2102'],
        sizedBy: null,
        checks: {
          C1: { state: 'blocked', detail: 'Enter the number of grouped circuits.' },
          C2: { state: 'not-calculated', detail: 'No size.' },
        },
        size: null,
        device: null,
        load: null,
        values: {
          ibA: 43.3,
          inA: 50,
          izA: null,
          vdOwnPct: null,
          vdTotalPct: null,
          ikMaxKa: null,
          ikMinKa: null,
          ipKa: null,
          zsMohm: null,
        },
        trace: [],
        runId: 'r',
        ranAt: '2026-11-18T08:00:00Z',
        engineVersion: 't',
        rulePackVersion: null,
        inputsKey: inputsKey(p),
      }),
    ];
    const issue = panelIssues(p).find((i) => i.code === 'E2102')!;
    expect(issue).toMatchObject({
      label: 'F-01 (TX-1 → DB-1)',
      text: 'Enter the number of grouped circuits',
      targetId: cable.id,
      floorId: f,
    });
    expect(issue.detail).toBe(
      'Derating factor not available (E2102): Enter the number of grouped circuits.',
    );
    // Shown for the floor, for the feeder, and for the DB it feeds.
    expect(issuesInScope(p, [issue], { selectedId: null, floorId: f })).toHaveLength(1);
    expect(issuesInScope(p, [issue], { selectedId: 'db', floorId: f })).toHaveLength(1);
    expect(issuesInScope(p, [issue], { selectedId: 'tx', floorId: f })).toHaveLength(0);
    // A feeder between floors is the Building tab's: not listed for a plan (22 Nov 2026).
    const between = { ...issue, floorId: null };
    expect(issuesInScope(p, [between], { selectedId: null, floorId: f })).toHaveLength(0);
    expect(issuesInScope(p, [between], { selectedId: 'db', floorId: f })).toHaveLength(0);
  });

  it('reads a result stored before 22 Nov 2026 with the W form of a warning (A-26)', () => {
    const r = StoredResultSchema.shape.errors.parse(['E1901', 'E2003']);
    expect(r).toEqual(['W1901', 'E2003']);
  });
});
