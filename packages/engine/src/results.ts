import { loadSummaries, type CheckCode, type ElementResult, type Project } from '@neuromep/shared';
import { getRulePack } from '@neuromep/rulepacks';
import type { CableSizeOutcome, SizedFeeder } from './cableSize.js';
import type { RiserCheck } from './checks.js';

/**
 * A Cable Size run as the results the project stores (FR-18, WBS 1.7.1): one per feeder, and one
 * per component it feeds (the same figures - the size, breaker and checks of its incoming feeder).
 * Sources have no incoming feeder and get no result.
 */

type Check = NonNullable<ElementResult['checks'][CheckCode]>;

const NOT_SELECTED: Check = {
  state: 'not-calculated',
  detail: 'Not calculated - not selected on Page 1',
};

const fromState = (state: string, detail?: string): Check => {
  if (state === 'not-run') return { state: 'not-calculated', detail: detail ?? 'No size.' };
  if (state === 'device-data-required') {
    return {
      state: 'not-calculated',
      detail: `Device data required (E2402). ${detail ?? ''}`.trim(),
    };
  }
  return { state: state as Check['state'], ...(detail ? { detail } : {}) };
};

/** Last trace line of a step, as the detail of its check. */
const lastOf = (f: SizedFeeder, step: string) =>
  f.trace.filter((t) => t.step === step).at(-1)?.detail;

function feederResult(
  project: Project,
  f: SizedFeeder,
  summaries: ReturnType<typeof loadSummaries>,
): ElementResult {
  const ticked = project.calculation.checks;
  const cable = project.model.cables.find((c) => c.id === f.cableId)!;
  const s = summaries.get(f.toId);
  const c7 = f.busbarWithstand ?? f.c7;
  return {
    elementId: f.cableId,
    status: f.status,
    provisionalReasons: [...new Set(f.provisionalReasons)],
    errors: [...new Set(f.errors)],
    sizedBy: f.sizedBy,
    checks: {
      C1: fromState(f.c1, lastOf(f, 'C1')),
      C2: fromState(f.c2, lastOf(f, 'C2')),
      C3: ticked.shortCircuit ? fromState(f.c3, lastOf(f, 'C3')) : NOT_SELECTED,
      C4: fromState(f.c4.state, f.c4.detail),
      C5: fromState(f.c5.state, f.c5.detail),
      C6: fromState(f.c6.state, f.c6.detail),
      C7: !ticked.shortCircuit
        ? NOT_SELECTED
        : c7
          ? fromState(c7.state, c7.detail)
          : { state: 'not-required', detail: 'No switchboard withstand to check.' },
      C8: fromState(f.c8.state, f.c8.detail),
      // C9 is a warning (10.14), never a failure.
      C9:
        f.c9.state === 'fail'
          ? { state: 'warning', detail: f.c9.detail }
          : fromState(f.c9.state, f.c9.detail),
    },
    size:
      f.size && cable.feederType !== 'busbar'
        ? {
            runs: f.size.runs,
            cores: cable.construction.cores,
            sizeMm2: f.size.sizeMm2,
            eccMm2: f.eccMm2,
            lengthM: f.lengthM,
          }
        : null,
    device: f.device
      ? {
          type: f.duty?.type ?? f.device.type,
          ratingA: f.device.ratingA,
          poles: f.device.poles,
          faultRatingKa: f.duty?.icuKa ?? null,
        }
      : null,
    load: s
      ? { connectedKw: s.connected, maxDemandKw: s.maxDemandKw, standbyKw: s.standbyKw }
      : null,
    values: {
      ibA: f.ibA,
      inA: f.device?.ratingA ?? null,
      izA: f.busbar ? f.busbar.ratingA : (f.rating?.izA ?? null),
      vdOwnPct: f.drop?.vcPct ?? null,
      vdTotalPct: f.vdTotalPct,
      ikMaxKa: f.faultAtBreaker?.ikMaxKa ?? null,
      ikMinKa: f.ikMinFarKa,
      ipKa: f.faultAtBreaker?.ipKa ?? null,
      zsMohm: f.zsHotMohm,
    },
    trace: [...f.trace, ...f.warnings.map((w) => ({ step: 'Warning', detail: w }))],
  };
}

export function elementResults(project: Project, outcome: CableSizeOutcome): ElementResult[] {
  const pack = getRulePack(project.rulePackId!, project.rulePackVersion!);
  const pf =
    project.calculation.defaultOverrides.defaultLoadPowerFactor ??
    pack.calculationDefaults.find((d) => d.key === 'defaultLoadPowerFactor')?.value;
  const summaries = loadSummaries(project, typeof pf === 'number' ? pf : null);
  const cables = new Map(project.model.cables.map((c) => [c.id, c]));
  const feeders = outcome.feeders.map((f) => feederResult(project, f, summaries));
  // A component: its incoming feeder; for an ATS the normal input.
  const incoming = new Map<string, ElementResult>();
  for (const r of feeders) {
    const c = cables.get(r.elementId)!;
    if (!incoming.has(c.to.elementId) || c.to.port !== 'standby') incoming.set(c.to.elementId, r);
  }
  const components = project.model.elements.flatMap((e) => {
    const r = incoming.get(e.id);
    return r ? [{ ...r, elementId: e.id }] : [];
  });
  return [...feeders, ...components];
}

export interface RiserCost {
  riserId: string;
  index: number;
  ratingA: number | null;
  costAed: number | null;
  detail: string;
}

/**
 * Building tab Cost (manager, 3 Nov 2026): each riser costs its busbar rating (A) x the rule-pack
 * rate (2.2 AED per ampere), one price per riser whatever its length.
 */
export function riserCosts(
  project: Project,
  risers: RiserCheck[],
): { risers: RiserCost[]; totalAed: number | null } {
  const pack = getRulePack(project.rulePackId!, project.rulePackVersion!);
  const override = project.calculation.defaultOverrides.riserCostAedPerA;
  const rate =
    typeof override === 'number'
      ? override
      : pack.calculationDefaults.find((d) => d.key === 'riserCostAedPerA')?.value;
  const rows = risers
    .filter((r) => r.lengthM)
    .map((r): RiserCost => {
      const ratingA = r.busbar?.ratingA ?? null;
      const costAed =
        ratingA !== null && typeof rate === 'number'
          ? Math.round(ratingA * rate * 100) / 100
          : null; // AED to 2 decimals
      return {
        riserId: r.riserId,
        index: r.index,
        ratingA,
        costAed,
        detail:
          costAed !== null
            ? `Riser ${r.index}: ${ratingA} A x ${rate} AED = ${costAed.toFixed(0)} AED`
            : `Riser ${r.index}: ${r.notes.at(-1) ?? 'no busbar rating yet'}`,
      };
    });
  const known = rows.filter((r) => r.costAed !== null);
  return {
    risers: rows,
    totalAed:
      rows.length && known.length === rows.length
        ? known.reduce((t, r) => t + r.costAed!, 0)
        : null,
  };
}
