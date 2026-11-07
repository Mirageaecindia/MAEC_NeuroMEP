import { describe, expect, it } from 'vitest';
import { EXAMPLES, workedExample } from './examples';

/** The guide's worked examples recompute each figure and agree with the engine (user request 7 Nov 2026). */
describe('#TASK-32 user guide worked examples', () => {
  it.each(Object.keys(EXAMPLES))('%s: the formula in the guide gives the engine figure', (id) => {
    const ex = workedExample(id);
    expect(ex.compare.length).toBeGreaterThan(0);
    for (const c of ex.compare) expect([c.label, c.guide, c.ok]).toEqual([c.label, c.guide, true]);
  });
});
