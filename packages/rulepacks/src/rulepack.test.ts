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
    expect(p.site.ambientSoilC).toEqual({ value: 40, source: 'rulepack' }); // manager 3 Nov 2026
    expect(p.site.soilResistivity).toEqual({ value: 2, source: 'rulepack' });
    expect(p.calculation.system).toEqual({
      voltageLineV: { value: 400, source: 'rulepack' },
      voltagePhaseV: { value: 230, source: 'rulepack' },
      frequencyHz: { value: 50, source: 'rulepack' },
    });
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

  it('holds the 12.2 defaults with the answers of 3 Nov 2026, open items null', () => {
    const d = Object.fromEntries(dubai.calculationDefaults.map((x) => [x.key, x]));
    expect(d.supplyVoltageLineV?.value).toBe(400);
    expect(d.supplyVoltagePhaseV?.value).toBe(230);
    expect(d.supplyFrequencyHz?.value).toBe(50);
    expect(d.defaultLoadPowerFactor?.value).toBe(0.85);
    expect(d.targetPowerFactor?.value).toBe(0.95);
    // CableSizer short-circuit method: c = 1 for 230/400 V.
    expect(d.voltageFactorCmax?.value).toBe(1);
    expect(d.voltageFactorCmin?.value).toBe(1);
    expect(d.disconnectionTimeDistributionS?.value).toBe(5);
    expect(d.disconnectionTimeFinalS?.value).toBe(0.4);
    expect(d['voltageDropLimitPct.DB']?.value).toBe(2.5);
    expect(d['voltageDropLimitPct.Motor']?.value).toBe(4);
    expect(d.cableLengthAllowancePct?.value).toBe(0);
    expect(d.cableLengthAdditionM?.value).toBe(5);
    expect(d.transformerLoadingLimitPct?.value).toBe(100);
    expect(d.maxParallelRuns?.value).toBeNull();
    expect(d.motorLockedRotorRatio?.value).toBe(6.5);
    expect(d.earthingSystem?.value).toBe('TN-S');
    expect(d.defaultDepthOfLayingM).toMatchObject({ value: null, interimDefault: null });
    expect(d.defaultCableConstruction).toMatchObject({ value: null, interimDefault: null });
  });

  it('shows Technical Lead overrides as overridden, and empty values as TBC', () => {
    const p = completeProject();
    p.calculation.defaultOverrides = { targetPowerFactor: 0.95 };
    const eff = Object.fromEntries(effectiveCalculationDefaults(p, dubai).map((x) => [x.key, x]));
    expect(eff.targetPowerFactor).toMatchObject({ effective: 0.95, overridden: true, tbc: false });
    expect(eff.defaultLoadPowerFactor).toMatchObject({ effective: 0.85, overridden: false });
    expect(eff.defaultDepthOfLayingM).toMatchObject({ effective: null, tbc: true });
  });

  it('holds the transformer uk and generator X"d data of 3 Nov 2026', () => {
    expect(dubai.sourceData.transformerUkPct[0]).toMatchObject({ maxPrimaryKv: 12 });
    expect(dubai.sourceData.generatorXdPct.find((g) => g.maxKva === 2000)).toEqual({
      maxKva: 2000,
      low: 12,
      high: 16,
    });
  });
});
