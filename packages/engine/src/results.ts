import { loadSummaries, type CheckCode, type ElementResult, type Project } from '@neuromep/shared';
import { breakerTypeFor, getRulePack, loadPowerFactors } from '@neuromep/rulepacks';
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
    calc: {
      ibCase: f.ibCase,
      pf: f.pf,
      itA: f.rating?.itA ?? null,
      k1: f.rating?.k1 ?? null,
      k2: f.rating?.k2 ?? null,
      kr: f.rating?.kr ?? null,
      k3: f.rating?.k3 ?? null,
      vuMvAm: f.drop?.vuMvAm ?? null,
      vdOwnV: f.drop?.vcV ?? null,
      vdUpstreamPct: f.vdUpstreamPct,
      vdLimitPct: f.vdLimitPct,
      busbarA: f.busbar?.ratingA ?? null,
      lengthM: f.lengthM,
      loadFactorK: null,
    },
    trace: [...f.trace, ...f.warnings.map((w) => ({ step: 'Warning', detail: w }))],
  };
}

export function elementResults(project: Project, outcome: CableSizeOutcome): ElementResult[] {
  const pack = getRulePack(project.rulePackId!, project.rulePackVersion!);
  const summaries = loadSummaries(project, loadPowerFactors(project, pack));
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
  const risers = outcome.risers.flatMap((r) => riserResults(project, r, summaries, incoming));
  return [...feeders, ...components, ...risers];
}

const EMPTY_VALUES: ElementResult['values'] = {
  ibA: null,
  inA: null,
  izA: null,
  vdOwnPct: null,
  vdTotalPct: null,
  ikMaxKa: null,
  ikMinKa: null,
  ipKa: null,
  zsMohm: null,
};

/**
 * A riser (Building tab) and the boards on its tap-offs (Section 14 busbar schedule): the riser
 * with its busbar rating and voltage drop; each board fed only by the riser gets the result of its
 * tap-off box - the breaker rating for its demand and the drop at the tap-off.
 */
function riserResults(
  project: Project,
  r: RiserCheck,
  summaries: ReturnType<typeof loadSummaries>,
  fedByFeeder: ReadonlyMap<string, ElementResult>,
): ElementResult[] {
  const pack = getRulePack(project.rulePackId!, project.rulePackVersion!);
  const status: ElementResult['status'] =
    r.ibA === null ? 'awaiting-load' : r.busbar ? 'final' : 'blocked';
  const trace = r.notes.map((detail) => ({ step: 'Riser', detail }));
  const c2: Check =
    r.c2 === 'not-run'
      ? { state: 'not-calculated', detail: r.notes.join(' ') }
      : { state: r.c2, detail: r.notes.at(-1) };
  const riser: ElementResult = {
    elementId: r.riserId,
    status,
    provisionalReasons: [],
    errors: status === 'blocked' ? ['E2102'] : [],
    sizedBy: null,
    checks: {
      C1: r.busbar
        ? { state: 'pass', detail: `${r.busbar.ratingA} A busbar vs In ${r.inA} A` }
        : { state: 'not-calculated', detail: r.notes.join(' ') },
      C2: c2,
    },
    size: null,
    device: null,
    load: null,
    values: {
      ...EMPTY_VALUES,
      ibA: r.ibA,
      inA: r.inA,
      izA: r.busbar?.ratingA ?? null,
      vdOwnPct: r.vdPct,
      vdTotalPct: r.vdTotalPct,
    },
    calc: {
      ibCase: null,
      pf: null,
      itA: null,
      k1: null,
      k2: null,
      kr: null,
      k3: null,
      vuMvAm: null,
      vdOwnV: null,
      vdUpstreamPct: r.vdTotalPct !== null && r.vdPct !== null ? r.vdTotalPct - r.vdPct : null,
      vdLimitPct: r.vdLimitPct,
      busbarA: r.busbar?.ratingA ?? null,
      lengthM: r.lengthM,
      loadFactorK: r.k,
    },
    trace,
  };
  const tapOffs = r.tapOffs
    .filter((t) => !fedByFeeder.has(t.boardId))
    .map((t): ElementResult => {
      const s = summaries.get(t.boardId);
      const board = project.model.elements.find((e) => e.id === t.boardId);
      const single = board && 'poles' in board && board.poles === 'SPN';
      const type = t.inA === null ? null : breakerTypeFor(pack.devices, t.inA);
      return {
        elementId: t.boardId,
        status: t.ibA === null ? 'awaiting-load' : status,
        provisionalReasons: [],
        errors: status === 'blocked' && t.ibA !== null ? ['E2102'] : [],
        sizedBy: null,
        checks: {
          C2: c2,
          C3: { state: 'not-calculated', detail: 'Tap-off breaker fault duty not calculated yet.' },
        },
        size: null,
        device:
          t.inA !== null && type
            ? { type: type.type, ratingA: t.inA, poles: single ? '1P' : '3P', faultRatingKa: null }
            : null,
        load: s
          ? { connectedKw: s.connected, maxDemandKw: s.maxDemandKw, standbyKw: s.standbyKw }
          : null,
        values: { ...EMPTY_VALUES, ibA: t.ibA, inA: t.inA, vdTotalPct: r.vdTotalPct },
        trace: [
          ...trace,
          {
            step: 'Tap-off',
            detail: `Tap-off box on Riser ${r.index}: Ib ${t.ibA?.toFixed(1) ?? '-'} A, breaker ${t.inA ?? '-'} A.`,
          },
        ],
      };
    });
  return [riser, ...tapOffs];
}

export interface RiserCost {
  riserId: string;
  index: number;
  ratingA: number | null;
  costAed: number | null;
  detail: string;
  /** Why there is no price yet, one sentence per missing input (empty once priced). */
  reasons: string[];
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
  // A riser in use: any of length, source or tap-offs entered (empty Riser Design rows are not).
  const used = (r: RiserCheck) => {
    const stored = project.model.risers[r.index - 1];
    return !!(r.lengthM || stored?.fedFromId || stored?.feeds.length);
  };
  const rows = risers.filter(used).map((r): RiserCost => {
    const ratingA = r.busbar?.ratingA ?? null;
    const costAed =
      ratingA !== null && typeof rate === 'number' ? Math.round(ratingA * rate * 100) / 100 : null; // AED to 2 decimals
    return {
      riserId: r.riserId,
      index: r.index,
      ratingA,
      costAed,
      detail:
        costAed !== null
          ? `Riser ${r.index}: ${ratingA} A x ${rate} AED = ${costAed.toFixed(0)} AED`
          : `Riser ${r.index}: ${r.notes.join(' ')}`,
      // The riser check leaves a note at every point it stops, so these are never empty.
      reasons: costAed !== null ? [] : r.notes,
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
