import { describe, expect, it } from 'vitest';
import { completeProject, FIXED_NOW } from '../testing.js';
import { createEmptyProject } from './factory.js';
import { page1Issues } from './readiness.js';
import type { Project } from './schema.js';

const ctx = { activeRegions: ['dubai'] as const };
const fields = (p: Project) => page1Issues(p, ctx).map((i) => i.field);

describe('Page 1 readiness (Next button gating)', () => {
  it('a complete project has no issues', () => {
    expect(page1Issues(completeProject(), ctx)).toEqual([]);
  });

  it('an empty project lists every required field, in screen order', () => {
    const issues = page1Issues(createEmptyProject({ id: 'p', userId: 'u', now: FIXED_NOW }), ctx);
    expect(issues.map((i) => i.field)).toEqual([
      'details.name',
      'details.location',
      'details.clientName',
      'details.plotRef',
      'details.designStage',
      'details.revision',
      'details.category',
      'details.plotLoad',
      'site.ambientAirC',
      'site.ambientSoilC',
      'site.soilResistivity',
      'calculation.region',
      'calculation.upstreamFaultMva',
      'building.registry',
      'workingDirectory',
      'disciplines.electrical',
    ]);
    const cards = issues.map((i) => i.card);
    expect(cards).toEqual([...cards].sort((a, b) => a - b));
  });

  it('plot load must be greater than 0', () => {
    const p = completeProject();
    p.details.plotLoad.value = 0;
    expect(page1Issues(p, ctx)).toEqual([
      { card: 1, field: 'details.plotLoad', message: 'Plot load must be greater than 0.' },
    ]);
  });

  it('checks site ranges; altitude is optional but range-checked when given', () => {
    const p = completeProject();
    p.site.ambientAirC.value = 61;
    p.site.soilResistivity.value = 0.4;
    expect(fields(p)).toEqual(['site.ambientAirC', 'site.soilResistivity']);
    const q = completeProject();
    q.site.altitudeM = null;
    expect(fields(q)).toEqual([]);
    q.site.altitudeM = 6000;
    expect(fields(q)).toEqual(['site.altitudeM']);
  });

  it('refuses a region without a rule pack', () => {
    const p = completeProject();
    p.calculation.region = 'abu-dhabi';
    expect(page1Issues(p, ctx)[0]?.message).toBe('No rule pack is available for this region yet.');
  });

  it('allows TBC (empty) demand factors but not values outside 0-1', () => {
    const p = completeProject();
    expect(p.calculation.demandFactors.byLoadType['1'].value).toBeNull();
    p.calculation.demandFactors.byLoadType['3'] = { value: 1.2, source: 'user' };
    p.calculation.demandFactors.byCategory.retail = { value: -0.1, source: 'user' };
    expect(fields(p)).toEqual([
      'calculation.demandFactors.byLoadType.3',
      'calculation.demandFactors.byCategory.retail',
    ]);
  });

  it('needs every floor height within 2.5-10 m', () => {
    const p = completeProject();
    const [b1, gf] = p.building.floors;
    b1!.heightM = null;
    gf!.heightM = 12;
    expect(fields(p)).toEqual([`floor.${b1!.id}.height`, `floor.${gf!.id}.height`]);
  });

  it('only the Electrical engineer assignment is required', () => {
    const p = completeProject();
    expect(p.disciplines.mechanical).toEqual([]);
    expect(p.disciplines.phe).toEqual([]);
    p.disciplines.electrical = [];
    expect(fields(p)).toEqual(['disciplines.electrical']);
  });

  it('needs at least one calibrated floor', () => {
    const p = completeProject();
    const gf = p.building.floors.find((f) => f.code === 'GF')!;
    if (gf.plan) gf.plan.calibration = null;
    expect(fields(p)).toEqual(['plans']);
  });
});
