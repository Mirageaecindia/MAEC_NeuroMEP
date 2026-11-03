import { describe, expect, it } from 'vitest';
import { conservativeStep, tableValue } from './tables.js';

describe('#TASK-21 CableSizer table access (V-14, OI-07)', () => {
  it('uses a row flagged for review, with its note', () => {
    const v = tableValue('VU', { CAB: 90, TYP: 'PVC', PHASES: 3 });
    expect(v.found && v.notes[0]).toMatch(/90 mm2 instead of 95/);
  });

  it('never uses CableSizer "else = 1" rows', () => {
    expect(tableValue('TEMPDE', { METHOD: 'J', TYP: 'XLPE', TEMP: 47 }).found).toBe(false);
  });

  it('treats an unknown table as a programming error', () => {
    expect(() => conservativeStep('NOT-A-TABLE', {}, 'X', 1)).toThrow(
      /Unknown CableSizer function/,
    );
  });
});
