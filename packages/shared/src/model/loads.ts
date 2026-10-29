import { LoadTypeCodeSchema, type LoadTypeCode } from '../project/enums.js';
import type { Project } from '../project/schema.js';
import type { Element, ElementKind, LoadLine } from './elements.js';

/**
 * Live load aggregation (design doc 10.3; 10.2 step 2 only - the right-side load table, FR-18).
 * Not the engine: no cable sizes, no fault levels. Updated on every model change.
 *
 * Demand factors (decision 29 Oct 2026, until OI-02): the load-type factor is applied once at each
 * board to its connected load per type (never multiplied down the tree); a TBC factor counts as
 * 1.0 (E1901); demand-category factors are not applied until OI-02 says how they combine, so the
 * maximum demand stays Provisional.
 */

export interface PhaseKw {
  L1: number;
  L2: number;
  L3: number;
}
const zero = (): PhaseKw => ({ L1: 0, L2: 0, L3: 0 });
const add = (a: PhaseKw, b: PhaseKw): PhaseKw => ({
  L1: a.L1 + b.L1,
  L2: a.L2 + b.L2,
  L3: a.L3 + b.L3,
});
const scale = (a: PhaseKw, f: number): PhaseKw => ({ L1: a.L1 * f, L2: a.L2 * f, L3: a.L3 * f });
const total = (a: PhaseKw) => a.L1 + a.L2 + a.L3;

export interface LoadSummary {
  /** Connected load per load type and phase (kW): own lines plus everything downstream. */
  byType: Partial<Record<LoadTypeCode, PhaseKw>>;
  connected: PhaseKw;
  connectedKw: number;
  /** Maximum demand per phase and in total (kW). */
  demand: PhaseKw;
  maxDemandKw: number;
  /** Standby load (kW): acquired from downstream, else as entered; null = not entered. */
  standbyKw: number | null;
  /** Power factor: the board's own, else the rule-pack default; equivalent pf for sums. */
  pf: number | null;
  /** Largest phase current at maximum demand, Ib = max(P_phase x 1000 / (230 x pf)) (10.4). */
  currentA: number | null;
  /** Load types whose demand factor is TBC and counted as 1.0 (E1901). */
  tbcFactors: LoadTypeCode[];
}

/** Boards apply the demand factor of each load type to their connected load (10.3). */
const BOARDS = new Set<ElementKind>([
  'lv-panel',
  'mdb',
  'emdb',
  'acb-panel',
  'smdb',
  'esmdb',
  'mcc',
  'emcc',
  'db',
]);

/** kW per phase of one load line: kW as entered, or area x W/m2 on its phase(s). */
export function lineKw(line: LoadLine): PhaseKw {
  if (line.method === 'kw') return { L1: line.kwL1, L2: line.kwL2, L3: line.kwL3 };
  const kw = (line.areaM2 * line.wPerM2) / 1000;
  if (line.phases === '3P') return { L1: kw / 3, L2: kw / 3, L3: kw / 3 };
  return { ...zero(), [line.phases]: kw };
}

/** Load lines entered on the element itself: DB loads, or manual loads of unconnected ways. */
export function ownLines(e: Element): LoadLine[] {
  if (e.kind === 'db') return e.loads;
  if ('manualLoads' in e) return e.manualLoads;
  return [];
}

const ownPf = (e: Element): number | null => (e.kind === 'db' ? e.powerFactor : null);
const ownStandby = (e: Element): number | null => ('standbyKw' in e ? e.standbyKw : null);
const reactive = (p: number, pf: number | null) =>
  pf && pf > 0 && pf < 1 ? p * Math.tan(Math.acos(pf)) : 0;

/**
 * Load summary of every element (connected, maximum demand, standby, pf, current), following the
 * cables downstream. `defaultPf` is the rule-pack default load power factor (12.2).
 */
export function loadSummaries(
  project: Pick<Project, 'model' | 'calculation'>,
  defaultPf: number | null,
): Map<string, LoadSummary> {
  const { elements, cables } = project.model;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const children = new Map<string, Element[]>();
  for (const c of cables) {
    const to = byId.get(c.to.elementId);
    if (to) children.set(c.from.elementId, [...(children.get(c.from.elementId) ?? []), to]);
  }
  const factors = project.calculation.demandFactors.byLoadType;
  const out = new Map<string, LoadSummary & { q: number }>();

  const visit = (e: Element, path: Set<string>): LoadSummary & { q: number } => {
    const done = out.get(e.id);
    if (done) return done;
    // The model is radial (topology rules); a loop in old data is cut here, not followed.
    const below = (children.get(e.id) ?? []).filter((c) => !path.has(c.id));
    const sub = below.map((c) => visit(c, new Set([...path, e.id])));

    const byType: Partial<Record<LoadTypeCode, PhaseKw>> = {};
    const addType = (code: LoadTypeCode, kw: PhaseKw) =>
      (byType[code] = add(byType[code] ?? zero(), kw));
    for (const line of ownLines(e)) addType(line.loadType, lineKw(line));
    for (const s of sub)
      for (const [code, kw] of Object.entries(s.byType)) addType(code as LoadTypeCode, kw);

    const connected = Object.values(byType).reduce(add, zero());
    const tbc = new Set<LoadTypeCode>(sub.flatMap((s) => s.tbcFactors));
    let demand: PhaseKw;
    if (BOARDS.has(e.kind)) {
      // Once at this board, per load type: a panel override (D-03) or the Page 1 factor.
      demand = zero();
      for (const [code, kw] of Object.entries(byType) as [LoadTypeCode, PhaseKw][]) {
        const override = 'demandFactorOverrides' in e ? e.demandFactorOverrides[code] : undefined;
        const df = override ?? factors[code].value;
        if (df === null) tbc.add(code);
        demand = add(demand, scale(kw, df ?? 1));
      }
    } else {
      // Sources, ATS, busbars and tap-off boxes carry the maximum demand of what they feed.
      demand = sub.reduce((d, s) => add(d, s.demand), zero());
    }

    // Power factor: entered on a DB; for a sum, the equivalent pf from P and Q.
    const ownKw = ownLines(e).reduce((s, l) => s + total(lineKw(l)), 0);
    const pfOwn = ownPf(e) ?? defaultPf;
    const p = total(connected);
    const q = reactive(ownKw, pfOwn) + sub.reduce((s, x) => s + x.q, 0);
    const pf = sub.length === 0 ? pfOwn : p > 0 ? p / Math.hypot(p, q) : pfOwn;
    const maxPhase = Math.max(demand.L1, demand.L2, demand.L3);
    const currentA = pf && maxPhase > 0 ? (maxPhase * 1000) / (230 * pf) : pf ? 0 : null;

    const acquired = sub.map((s) => s.standbyKw).filter((v): v is number => v !== null);
    const standbyKw =
      sub.length > 0
        ? acquired.length
          ? acquired.reduce((a, b) => a + b, 0)
          : null
        : ownStandby(e);

    const summary = {
      byType,
      connected,
      connectedKw: p,
      demand,
      maxDemandKw: total(demand),
      standbyKw,
      pf,
      currentA,
      tbcFactors: LoadTypeCodeSchema.options.filter((c) => tbc.has(c)),
      q,
    };
    out.set(e.id, summary);
    return summary;
  };
  for (const e of elements) visit(e, new Set());
  return new Map([...out].map(([id, { q: _q, ...s }]) => [id, s]));
}

/** Whether any demand-category factor has been entered: they are not applied until OI-02. */
export const categoryFactorsPending = (project: Pick<Project, 'calculation'>) =>
  Object.values(project.calculation.demandFactors.byCategory).some((f) => f.value !== null);
