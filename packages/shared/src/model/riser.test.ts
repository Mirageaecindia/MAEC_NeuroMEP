import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../project/factory.js';
import { ProjectSchema } from '../project/schema.js';
import { FIXED_NOW } from '../testing.js';
import { riserRows } from './riser.js';

describe('#TASK-17 Riser Design (FR-20, A-05)', () => {
  it('shows three rows, keeping the stored risers', () => {
    expect(riserRows([]).map((r) => r.id)).toEqual(['riser-1', 'riser-2', 'riser-3']);
    const rows = riserRows([{ id: 'riser-1', lengthM: 26, widthM: 0.4 }]);
    expect(rows[0]).toEqual({ id: 'riser-1', lengthM: 26, widthM: 0.4 });
    expect(rows).toHaveLength(3);
  });

  it('loads projects stored before risers existed, with no risers', () => {
    const p = createEmptyProject({ id: 'p', userId: 'u', now: FIXED_NOW });
    const { risers: _r, ...oldModel } = p.model;
    expect(ProjectSchema.parse({ ...p, model: oldModel }).model.risers).toEqual([]);
  });

  it('refuses a length of 0 or less', () => {
    const p = createEmptyProject({ id: 'p', userId: 'u', now: FIXED_NOW });
    p.model.risers = [{ id: 'riser-1', lengthM: 0, widthM: null }];
    expect(ProjectSchema.safeParse(p).success).toBe(false);
  });
});
