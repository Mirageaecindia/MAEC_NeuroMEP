import { DEMAND_CATEGORY_LABELS, LOAD_TYPE_LABELS } from './enums.js';
import type { DefaultableNumber, Project } from './schema.js';

/**
 * D-19: until the demand-factor values are known (OI-01), the engine takes a TBC factor as 1.0
 * (no diversity - conservative) and labels every result that depends on it with this status.
 * Such results never become Final.
 */
export const TBC_DEMAND_FACTOR_INTERIM = 1.0;
export const PROVISIONAL_DEMAND_FACTORS_TBC = 'Provisional – demand factors TBC';

/** The factor the engine uses, and whether it is the TBC interim value. */
export function effectiveDemandFactor(df: DefaultableNumber): { value: number; tbc: boolean } {
  return df.value === null
    ? { value: TBC_DEMAND_FACTOR_INTERIM, tbc: true }
    : { value: df.value, tbc: false };
}

export interface TbcDemandFactor {
  table: 'byLoadType' | 'byCategory';
  key: string;
  label: string;
}

/** Demand factors that are still TBC (no value), for the Page 1 warning banner. */
export function tbcDemandFactors(project: Pick<Project, 'calculation'>): TbcDemandFactor[] {
  const { byLoadType, byCategory } = project.calculation.demandFactors;
  return [
    ...Object.entries(byLoadType)
      .filter(([, df]) => df.value === null)
      .map(([key]) => ({
        table: 'byLoadType' as const,
        key,
        label: LOAD_TYPE_LABELS[key as keyof typeof LOAD_TYPE_LABELS],
      })),
    ...Object.entries(byCategory)
      .filter(([, df]) => df.value === null)
      .map(([key]) => ({
        table: 'byCategory' as const,
        key,
        label: DEMAND_CATEGORY_LABELS[key as keyof typeof DEMAND_CATEGORY_LABELS],
      })),
  ];
}
