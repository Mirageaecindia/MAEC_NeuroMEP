import type { DefaultableNumber, Project } from '@neuromep/shared';
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
 * Loads a rule pack into a project (FR-04): records the pack id and version, and pre-fills site
 * defaults and demand factors - only fields the user has not edited. TBC values stay null.
 */
export function applyRulePackDefaults(project: Project, pack: RulePack): Project {
  const df = project.calculation.demandFactors;
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
      demandFactors: {
        byLoadType: fillRecord(df.byLoadType, pack.demandFactors.byLoadType),
        byCategory: fillRecord(df.byCategory, pack.demandFactors.byCategory),
      },
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
