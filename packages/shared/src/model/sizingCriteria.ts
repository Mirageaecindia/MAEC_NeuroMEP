import { z } from 'zod';
import type { ElementKind } from './elements.js';
import type { Project } from '../project/schema.js';
import type { LoadSummary, PhaseKw } from './loads.js';

/**
 * Breaker / Cable Sizing Criteria (manager's list, A-30, 26 Nov 2026): for each level the
 * incoming breaker and cable are sized on the Demand load or the Connected load; under Demand,
 * the Calculated demand (the demand method: briefing page 10) or a user-defined demand factor x
 * the connected load. Import File, below Load Power Factor. Missing = Demand, Calculated.
 */
export const SIZING_LEVELS = ['main', 'riser', 'smdb', 'mcc', 'db'] as const;
export type SizingLevel = (typeof SIZING_LEVELS)[number];

export const SIZING_LEVEL_LABELS: Record<SizingLevel, string> = {
  main: 'Incomer to LV Panel / MDB',
  riser: 'Busbar risers',
  smdb: 'Incomer to SMDB',
  mcc: 'Incomer to MCC',
  db: "Incomer to DB's / control panels / isolators, etc.",
};

/** What "Calculated" means at each level (briefing page 10; MCC as SMDB, user decision). */
export const SIZING_CALCULATED_HINT: Record<SizingLevel, string> = {
  main: 'Category factors of the demand method (non-Emaar 0.65 residential, 0.8 landlord / office / retail; Emaar 0.6 / 0.75 / 0.8).',
  riser: 'Category factors of the demand method on the boards of its tap-offs, as at the LV panel.',
  smdb: 'SMDB-level factor of the demand method (non-Emaar 1.0, Emaar 0.8).',
  mcc: 'As the SMDB level (non-Emaar 1.0, Emaar 0.8).',
  db: '100 % (downstream of the SMDB).',
};

export const SizingCriterionSchema = z.object({
  basis: z.enum(['demand', 'connected']),
  mode: z.enum(['calculated', 'user']),
  /** User-defined demand factor (0 < f <= 1); null until entered. */
  factor: z.number().positive().max(1).nullable(),
});
export type SizingCriterion = z.infer<typeof SizingCriterionSchema>;

export const SizingCriteriaSchema = z
  .object(
    Object.fromEntries(SIZING_LEVELS.map((l) => [l, SizingCriterionSchema.optional()])) as Record<
      SizingLevel,
      z.ZodOptional<typeof SizingCriterionSchema>
    >,
  )
  .default({});

export const DEFAULT_CRITERION: SizingCriterion = {
  basis: 'demand',
  mode: 'calculated',
  factor: null,
};

export const criterionOf = (p: Pick<Project, 'calculation'>, level: SizingLevel) =>
  p.calculation.sizingCriteria?.[level] ?? DEFAULT_CRITERION;

/** The level whose criterion sizes the feeder into a component; null = always its demand. */
export function sizingLevelOf(kind: ElementKind): Exclude<SizingLevel, 'riser'> | null {
  if (['lv-panel', 'mdb', 'emdb', 'acb-panel'].includes(kind)) return 'main';
  if (kind === 'smdb' || kind === 'esmdb') return 'smdb';
  if (kind === 'mcc' || kind === 'emcc') return 'mcc';
  if (['transformer', 'generator', 'ats', 'ups', 'pfc-bank'].includes(kind)) return null;
  return 'db';
}

const scale = (a: PhaseKw, f: number): PhaseKw => ({ L1: a.L1 * f, L2: a.L2 * f, L3: a.L3 * f });

/**
 * Each demand category's connected load x its factor (Dubai methods; a TBC factor counts 1.0,
 * W1901); the manual method keeps the board's demand. The MD column of the schedules (the row's
 * share of the maximum demand, as the manager's schedules) and a riser's calculated demand.
 */
export function categoryDemand(
  p: Pick<Project, 'calculation'>,
  s: Pick<LoadSummary, 'byCategory' | 'demand'>,
): PhaseKw {
  if ((p.calculation.demandMethod ?? 'dubai-non-emaar') === 'manual') return s.demand;
  const out = { L1: 0, L2: 0, L3: 0 };
  for (const [cat, kw] of Object.entries(s.byCategory) as [string, PhaseKw][]) {
    const f =
      cat === 'none'
        ? 1
        : (p.calculation.demandFactors.byCategory[
            cat as keyof typeof p.calculation.demandFactors.byCategory
          ]?.value ?? 1);
    out.L1 += kw.L1 * f;
    out.L2 += kw.L2 * f;
    out.L3 += kw.L3 * f;
  }
  return out;
}

export type SizingLoad = { ok: true; kw: PhaseKw; detail: string } | { ok: false; detail: string };

/**
 * The load a feeder (or riser) is sized on under the level's criterion: the connected load, the
 * calculated demand, or connected x the user-defined factor (never assumed when missing, V-14).
 */
export function sizingLoad(
  p: Pick<Project, 'calculation'>,
  level: SizingLevel,
  connected: PhaseKw,
  calculated: PhaseKw,
): SizingLoad {
  const c = criterionOf(p, level);
  const name = SIZING_LEVEL_LABELS[level];
  if (c.basis === 'connected') {
    return { ok: true, kw: connected, detail: `${name}: sized on the connected load (TCL).` };
  }
  if (c.mode === 'user') {
    if (c.factor === null) {
      return {
        ok: false,
        detail: `${name}: enter the user-defined demand factor in Import File > Breaker / Cable Sizing Criteria.`,
      };
    }
    return {
      ok: true,
      kw: scale(connected, c.factor),
      detail: `${name}: sized on the demand load, user-defined demand factor ${c.factor} x connected load.`,
    };
  }
  return { ok: true, kw: calculated, detail: `${name}: sized on the calculated demand load.` };
}
