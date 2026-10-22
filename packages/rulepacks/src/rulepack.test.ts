import { createEmptyProject } from '@neuromep/shared';
import { completeProject, FIXED_NOW } from '@neuromep/shared/testing';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_REGIONS,
  applyRulePackDefaults,
  effectiveCalculationDefaults,
  rulePackForRegion,
} from './index.js';

const dubai = rulePackForRegion('dubai')!;
const empty = () => createEmptyProject({ id: 'p', userId: 'u', now: FIXED_NOW });

describe('rule packs', () => {
  it('only Dubai is active in v1 (D-09)', () => {
    expect(ACTIVE_REGIONS).toEqual(['dubai']);
    expect(rulePackForRegion('abu-dhabi')).toBeNull();
    expect(rulePackForRegion('others')).toBeNull();
  });

  it('pre-fills site defaults and records the rule-pack version', () => {
    const p = applyRulePackDefaults(empty(), dubai);
    expect(p.rulePackId).toBe('dubai');
    expect(p.rulePackVersion).toBe('1.0.0');
    expect(p.site.ambientAirC).toEqual({ value: 50, source: 'rulepack' });
    expect(p.site.ambientSoilC).toEqual({ value: 35, source: 'rulepack' });
    expect(p.site.soilResistivity).toEqual({ value: 2, source: 'rulepack' });
  });

  it('applies defaults only to fields the user has not edited', () => {
    const p = empty();
    p.site.ambientSoilC = { value: 28, source: 'user' };
    p.calculation.demandFactors.byLoadType['1'] = { value: 0.9, source: 'user' };
    const q = applyRulePackDefaults(p, dubai);
    expect(q.site.ambientSoilC).toEqual({ value: 28, source: 'user' });
    expect(q.site.ambientAirC).toEqual({ value: 50, source: 'rulepack' });
    expect(q.calculation.demandFactors.byLoadType['1']).toEqual({ value: 0.9, source: 'user' });
  });

  it('keeps TBC demand factors null (OI-01) - no invented values', () => {
    const q = applyRulePackDefaults(empty(), dubai);
    for (const df of [
      ...Object.values(q.calculation.demandFactors.byLoadType),
      ...Object.values(q.calculation.demandFactors.byCategory),
    ]) {
      expect(df).toEqual({ value: null, source: 'rulepack' });
    }
  });

  it('holds the 12.2 defaults, with open items null and their interim defaults recorded', () => {
    const d = Object.fromEntries(dubai.calculationDefaults.map((x) => [x.key, x]));
    expect(d.supplyVoltageLineV?.value).toBe(400);
    expect(d.supplyVoltagePhaseV?.value).toBe(230);
    expect(d.supplyFrequencyHz?.value).toBe(50);
    expect(d.defaultLoadPowerFactor?.value).toBe(0.85);
    expect(d.targetPowerFactor?.value).toBe(0.92);
    expect(d['voltageDropLimitPct.DB']?.value).toBe(2.5);
    expect(d['voltageDropLimitPct.Motor']?.value).toBe(4);
    expect(d.cableLengthAllowancePct).toMatchObject({ value: null, interimDefault: 10 });
    expect(d.transformerLoadingLimitPct).toMatchObject({ value: null, interimDefault: 80 });
    expect(d.defaultDepthOfLayingM).toMatchObject({ value: null, interimDefault: null });
    expect(d.defaultCableConstruction).toMatchObject({ value: null, interimDefault: null });
  });

  it('shows Technical Lead overrides as overridden, and empty values as TBC', () => {
    const p = completeProject();
    p.calculation.defaultOverrides = { targetPowerFactor: 0.95 };
    const eff = Object.fromEntries(effectiveCalculationDefaults(p, dubai).map((x) => [x.key, x]));
    expect(eff.targetPowerFactor).toMatchObject({ effective: 0.95, overridden: true, tbc: false });
    expect(eff.defaultLoadPowerFactor).toMatchObject({ effective: 0.85, overridden: false });
    expect(eff.transformerLoadingLimitPct).toMatchObject({ effective: null, tbc: true });
  });
});
