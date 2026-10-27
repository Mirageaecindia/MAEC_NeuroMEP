import { describe, expect, it } from 'vitest';
import { canOpenPage, reachedPage } from './progress.js';

describe('#TASK-02 tab progression (A-12)', () => {
  it('a project saved before A-12 has reached its last page', () => {
    expect(reachedPage({ lastPage: 'architecture' })).toBe('architecture');
  });

  it('going back to an earlier page keeps the furthest page reached', () => {
    const meta = { lastPage: 'setup' as const, reachedPage: 'architecture' as const };
    expect(reachedPage(meta)).toBe('architecture');
    expect(canOpenPage(meta, 'modelling')).toBe(true);
    expect(canOpenPage(meta, 'architecture')).toBe(true);
    expect(canOpenPage(meta, 'simulation-report')).toBe(false);
  });
});
