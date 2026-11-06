import {
  LoadTypeCodeSchema,
  type DefaultableNumber,
  type LoadPowerFactors,
  type LoadTypeCode,
  type Project,
} from '@neuromep/shared';
import type { CalculationDefault, RulePack } from './schema.js';

const fill = (current: DefaultableNumber, value: number | null): DefaultableNumber =>
  current.source === 'user' ? current : { value, source: 'rulepack' };

function fillRecord<K extends string>(
  current: Record<K, DefaultableNumber>,
  defaults: Record<K, number | null>,
): Record<K, DefaultableNumber> {
  const out = { ...current };
  for (const k of Object.keys(current) as K[]) out[k] = fill(current[k], defaults[k]);
  return out;
}

/**
 * Demand factors for a method: the Dubai methods fill the category and SMDB factors from the rule
 * pack's set; the manual method keeps the pack's load-type defaults. Values the user typed stay.
 */
export function demandFactorsFor(
  method: Project['calculation']['demandMethod'],
  df: Project['calculation']['demandFactors'],
  pack: RulePack,
): Project['calculation']['demandFactors'] {
  const set = method === 'manual' ? null : pack.demandMethods[method];
  return {
    byLoadType: fillRecord(df.byLoadType, pack.demandFactors.byLoadType),
    byCategory: fillRecord(df.byCategory, set?.byCategory ?? pack.demandFactors.byCategory),
    secondLevel: fill(df.secondLevel, set?.secondLevel ?? null),
  };
}

/**
 * Loads a rule pack into a project (FR-04): records the pack id and version, and pre-fills site
 * defaults, system voltage / frequency and demand factors - only fields the user has not edited. TBC values stay null.
 */
export function applyRulePackDefaults(project: Project, pack: RulePack): Project {
  const df = project.calculation.demandFactors;
  const sys = project.calculation.system;
  const num = (key: string) => {
    const v = pack.calculationDefaults.find((d) => d.key === key)?.value;
    return typeof v === 'number' ? v : null;
  };
  return {
    ...project,
    rulePackId: pack.id,
    rulePackVersion: pack.version,
    site: {
      ...project.site,
      ambientAirC: fill(project.site.ambientAirC, pack.siteDefaults.ambientAirC),
      ambientSoilC: fill(project.site.ambientSoilC, pack.siteDefaults.ambientSoilC),
      soilResistivity: fill(project.site.soilResistivity, pack.siteDefaults.soilResistivity),
    },
    calculation: {
      ...project.calculation,
      // System voltage / frequency on Page 1 default from the rule pack (12.1, 12.2).
      system: {
        voltageLineV: fill(sys.voltageLineV, num('supplyVoltageLineV')),
        voltagePhaseV: fill(sys.voltagePhaseV, num('supplyVoltagePhaseV')),
        frequencyHz: fill(sys.frequencyHz, num('supplyFrequencyHz')),
      },
      demandFactors: demandFactorsFor(project.calculation.demandMethod, df, pack),
    },
  };
}

export interface EffectiveDefault extends CalculationDefault {
  effective: number | string | null;
  overridden: boolean;
  /** No value yet: shown as TBC. */
  tbc: boolean;
}

/** Calculation defaults as the project uses them: the rule-pack value unless the Technical Lead overrode it. */
export function effectiveCalculationDefaults(project: Project, pack: RulePack): EffectiveDefault[] {
  return pack.calculationDefaults.map((d) => {
    const override = project.calculation.defaultOverrides[d.key];
    const overridden = override !== undefined;
    const effective = overridden ? override : d.value;
    return { ...d, effective, overridden, tbc: effective === null };
  });
}

/** Rule-pack key of a load type's power factor. */
export const loadPowerFactorKey = (code: LoadTypeCode) => `loadPowerFactor.${code}`;

/**
 * Power factors the project uses (12.2; per load type, manager 3 Nov 2026): the Technical Lead's
 * override, else the rule-pack value; a load type without one takes the default load power factor.
 */
export function loadPowerFactors(
  project: Pick<Project, 'calculation'>,
  pack: RulePack,
): LoadPowerFactors {
  const num = (key: string) => {
    const o = project.calculation.defaultOverrides[key];
    if (typeof o === 'number') return o;
    const v = pack.calculationDefaults.find((d) => d.key === key)?.value;
    return typeof v === 'number' ? v : null;
  };
  const byType: LoadPowerFactors['byType'] = {};
  for (const code of LoadTypeCodeSchema.options) byType[code] = num(loadPowerFactorKey(code));
  return { defaultPf: num('defaultLoadPowerFactor'), byType };
}
