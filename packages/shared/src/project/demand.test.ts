import { describe, expect, it } from 'vitest';
import { completeProject } from '../testing.js';
import {
  effectiveDemandFactor,
  PROVISIONAL_DEMAND_FACTORS_TBC,
  tbcDemandFactors,
} from './demand.js';
import { LOAD_TYPE_LABELS } from './enums.js';
import { page1Issues } from './readiness.js';

describe('demand factors TBC (D-19)', () => {
  it('uses the Project Set-up slide labels', () => {
    expect(Object.values(LOAD_TYPE_LABELS)).toEqual([
      'Lighting',
      'Power',
      'AC',
      'Heater',
      'Laundry',
      'Kitchen',
      'Hand Dryer',
      'Pumps',
      'Fire Pumps',
      'Special Equipment',
      'Lifts & Equipment',
      'Spare',
    ]);
  });

  it('lists every factor without a value, and none once all are set', () => {
    const p = completeProject();
    expect(tbcDemandFactors(p)).toHaveLength(16);
    p.calculation.demandFactors.byLoadType['1'] = { value: 0.8, source: 'user' };
    expect(tbcDemandFactors(p).map((f) => f.label)).not.toContain('Lighting');
    for (const df of Object.values(p.calculation.demandFactors.byLoadType)) df.value = 0.7;
    for (const df of Object.values(p.calculation.demandFactors.byCategory)) df.value = 0.9;
    expect(tbcDemandFactors(p)).toEqual([]);
  });

  it('takes a TBC factor as 1.0 and flags it, so results stay Provisional', () => {
    expect(effectiveDemandFactor({ value: null, source: 'rulepack' })).toEqual({
      value: 1,
      tbc: true,
    });
    expect(effectiveDemandFactor({ value: 0.6, source: 'user' })).toEqual({
      value: 0.6,
      tbc: false,
    });
    expect(PROVISIONAL_DEMAND_FACTORS_TBC).toBe('Provisional – demand factors TBC');
  });

  it('TBC factors do not block Next', () => {
    const p = completeProject();
    expect(tbcDemandFactors(p).length).toBeGreaterThan(0);
    expect(page1Issues(p, { activeRegions: ['dubai'] })).toEqual([]);
  });
});
