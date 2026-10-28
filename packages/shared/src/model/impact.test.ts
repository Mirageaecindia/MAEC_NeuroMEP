import { describe, expect, it } from 'vitest';
import { completeProject, modelledProject, sampleDb } from '../testing.js';
import { describeImpact, hasModel, modelImpact } from './impact.js';

describe('#TASK-04 impact of a change to an earlier page (Section 9)', () => {
  it('is empty before anything is modelled', () => {
    const impact = modelImpact(completeProject());
    expect(impact).toEqual({ floors: [], panels: 0, cables: 0 });
    expect(hasModel(impact)).toBe(false);
  });

  it('lists the modelled floors, panels and cables', () => {
    const p = modelledProject();
    const first = p.building.floors.find((f) => f.code === '1')!;
    p.model.elements.push(sampleDb(first.id, 'db-2'));
    const impact = modelImpact(p);
    expect(impact).toEqual({ floors: ['Ground Floor', 'First Floor'], panels: 2, cables: 0 });
    expect(describeImpact(impact)).toBe(
      '2 floors (Ground Floor, First Floor), 2 panels and 0 cables',
    );
  });
});
