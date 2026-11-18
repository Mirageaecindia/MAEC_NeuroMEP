import { cableSize, elementResults } from '@neuromep/engine';
import { inputsKey, mergeRun, type Element } from '@neuromep/shared';
import { completeProject, sampleDb, testCable, testElement } from '@neuromep/shared/testing';
import { describe, expect, it } from 'vitest';
import { issuesInScope, panelIssues } from './issues';

describe('right panel issues (18 Nov 2026)', () => {
  it('a blocked feeder says exactly what is missing, e.g. the grouped circuits (E2102)', () => {
    const p = completeProject();
    const f = p.building.floors[0]!.id;
    const tx = { ...testElement('transformer', 'tx', f), tag: 'TX-1', kva: 1000 } as Element;
    const db = {
      ...sampleDb(f, 'db'),
      tag: 'DB-1',
      loads: [{ method: 'kw', loadType: '2', kwL1: 10, kwL2: 10, kwL3: 10 }],
    } as Element;
    const cable = { ...testCable(tx, db), tag: 'F-01' };
    cable.construction = { ...cable.construction, method: 'J', groupedCircuits: null };
    p.model.elements = [tx, db];
    p.model.cables = [cable];
    p.model.results = mergeRun(p, { kind: 'project' }, elementResults(p, cableSize(p)), {
      runId: 'r',
      at: '2026-11-18T08:00:00Z',
      engineVersion: 't',
      inputsKey: inputsKey(p),
    });
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
  });
});
