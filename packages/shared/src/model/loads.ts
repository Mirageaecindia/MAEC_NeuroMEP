import {
  DemandCategorySchema,
  LoadTypeCodeSchema,
  type DemandCategory,
  type LoadTypeCode,
} from '../project/enums.js';
import type { Project } from '../project/schema.js';
import type { Element, ElementKind, Equipment, LoadLine } from './elements.js';

/**
 * Live load aggregation (design doc 10.3; 10.2 step 2 only - the right-side load table, FR-18).
 * Not the engine: no cable sizes, no fault levels. Updated on every model change.
 *
 * Demand factors are applied once at a board to its connected load (never multiplied down the
 * tree); a TBC factor counts as 1.0 (E1901). Two methods (`calculation.demandMethod`):
 * - Dubai (manager's answer 3 Nov 2026): the demand-category factor of each category at the LV
 *   panel / MDB level only, the SMDB-level factor at SMDBs (1.0, Emaar 0.8), 100 % elsewhere.
 * - Manual (A-15): the load-type factor at every board, with panel overrides (D-03).
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
  /** Connected load per demand category and phase (kW); loads without a category are 'none'. */
  byCategory: Partial<Record<DemandCategory | 'none', PhaseKw>>;
  /** Load types (manual) or categories (Dubai) whose factor is TBC and counted as 1.0 (E1901). */
  tbcFactors: LoadTypeCode[];
  tbcCategories: DemandCategory[];
  /** Equipment at or below whose input load cannot be worked out (no efficiency, E2003). */
  incomplete: string[];
}

/**
 * Power factor of each load type (manager 3 Nov 2026: lighting 0.85, sockets / HVAC 0.8, heater
 * 1.0, editable) and the default load power factor for types without one. A number = one power
 * factor for every load type.
 */
export interface LoadPowerFactors {
  defaultPf: number | null;
  byType: Partial<Record<LoadTypeCode, number | null>>;
}

/** Main boards: the Dubai category factors apply here (LV panel / MDB level). */
const MAIN = new Set<ElementKind>(['lv-panel', 'mdb', 'emdb', 'acb-panel']);
const SECOND = new Set<ElementKind>(['smdb', 'esmdb']);

/** Demand category of a load: its DB's or load point's own category; none for panel lines. */
const categoryOf = (e: Element): DemandCategory | 'none' =>
  'demandCategory' in e && e.demandCategory ? e.demandCategory : 'none';

/** Boards apply the demand factor of each load type to their connected load (10.3, manual). */
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

/**
 * Input load of mechanical / PHE equipment (kW): rated output / efficiency. Motor-driven equipment
 * (with a starter) needs its efficiency - null when missing, never assumed (E2003); other
 * equipment takes 1.0 when none is entered (user decision 6 Nov 2026). 0 without a kW.
 */
export function equipmentInputKw(e: Equipment): number | null {
  if (e.kw === null) return 0;
  const eff = e.efficiency ?? (e.starter ? null : 1);
  return eff ? e.kw / eff : null;
}

/**
 * A motor typed straight onto an isolator / connection unit (a starter chosen, manager feedback
 * 7 Nov 2026): its load lines are the motor's rated output, so the input is kW / efficiency.
 * 1 without a starter; null when the starter is set but the efficiency is not (E2003).
 */
export function starterInputFactor(e: Element): number | null {
  if ((e.kind !== 'isolator' && e.kind !== 'connection-unit') || !e.starter) return 1;
  return e.efficiency ? 1 / e.efficiency : null;
}

const scaleLine = (l: LoadLine, f: number): LoadLine =>
  l.method === 'kw'
    ? { ...l, kwL1: l.kwL1 * f, kwL2: l.kwL2 * f, kwL3: l.kwL3 * f }
    : { ...l, wPerM2: l.wPerM2 * f };

/** Load lines entered on the element itself: DB loads, or manual loads of unconnected ways. */
export function ownLines(e: Element): LoadLine[] {
  if (e.kind === 'db') return e.loads;
  if ('manualLoads' in e) {
    const f = starterInputFactor(e);
    return f === null || f === 1 ? e.manualLoads : e.manualLoads.map((l) => scaleLine(l, f));
  }
  if (e.kind === 'equipment') {
    const kw = equipmentInputKw(e);
    if (!kw) return [];
    const third = e.phases === '3P' ? kw / 3 : 0;
    const on = (ph: 'L1' | 'L2' | 'L3') => (e.phases === ph ? kw : third);
    return [{ method: 'kw', loadType: e.loadType, kwL1: on('L1'), kwL2: on('L2'), kwL3: on('L3') }];
  }
  return [];
}

const ownPf = (e: Element): number | null =>
  e.kind === 'db' || e.kind === 'equipment' ? e.powerFactor : null;
const ownStandby = (e: Element): number | null => ('standbyKw' in e ? e.standbyKw : null);
const reactive = (p: number, pf: number | null | undefined) =>
  pf && pf > 0 && pf < 1 ? p * Math.tan(Math.acos(pf)) : 0;

/**
 * Load summary of every element (connected, maximum demand, standby, pf, current), following the
 * cables downstream. `powerFactors`: the power factor per load type and the rule-pack default
 * (12.2); a DB's own power factor, when entered, applies to all its loads.
 */
export function loadSummaries(
  project: Pick<Project, 'model' | 'calculation'>,
  powerFactors: number | null | LoadPowerFactors,
): Map<string, LoadSummary> {
  const pfs: LoadPowerFactors =
    typeof powerFactors === 'object' && powerFactors !== null
      ? powerFactors
      : { defaultPf: powerFactors, byType: {} };
  const defaultPf = pfs.defaultPf;
  const typePf = (code: LoadTypeCode) => pfs.byType[code] ?? defaultPf;
  const { elements, cables, risers } = project.model;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const children = new Map<string, Element[]>();
  const link = (fromId: string, toId: string) => {
    const to = byId.get(toId);
    if (to) children.set(fromId, [...(children.get(fromId) ?? []), to]);
  };
  for (const c of cables) link(c.from.elementId, c.to.elementId);
  // Boards on a riser tap-off are fed by the riser's source (FR-20).
  for (const r of risers ?? []) if (r.fedFromId) for (const id of r.feeds) link(r.fedFromId, id);
  // Equipment hands its load to the isolator / connection unit it is fed from (6 Nov 2026).
  for (const e of elements) if (e.kind === 'equipment' && e.fedFromId) link(e.fedFromId, e.id);
  const factors = project.calculation.demandFactors.byLoadType;
  const method = project.calculation.demandMethod ?? 'dubai-non-emaar';
  const catFactors = project.calculation.demandFactors.byCategory;
  const secondLevel = project.calculation.demandFactors.secondLevel?.value ?? null;
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

    const byCategory: Partial<Record<DemandCategory | 'none', PhaseKw>> = {};
    const addCat = (cat: DemandCategory | 'none', kw: PhaseKw) =>
      (byCategory[cat] = add(byCategory[cat] ?? zero(), kw));
    for (const line of ownLines(e)) addCat(categoryOf(e), lineKw(line));
    for (const s of sub)
      for (const [cat, kw] of Object.entries(s.byCategory)) addCat(cat as DemandCategory, kw);

    const connected = Object.values(byType).reduce(add, zero());
    const tbc = new Set<LoadTypeCode>(sub.flatMap((s) => s.tbcFactors));
    const tbcCat = new Set<DemandCategory>(sub.flatMap((s) => s.tbcCategories));
    let demand: PhaseKw;
    if (method !== 'manual') {
      if (MAIN.has(e.kind)) {
        // Dubai: each category's connected load x its factor, once, at the LV panel / MDB.
        demand = zero();
        for (const [cat, kw] of Object.entries(byCategory) as [
          DemandCategory | 'none',
          PhaseKw,
        ][]) {
          const df = cat === 'none' ? 1 : catFactors[cat].value;
          if (df === null && cat !== 'none') tbcCat.add(cat);
          demand = add(demand, scale(kw, df ?? 1));
        }
      } else if (SECOND.has(e.kind)) {
        demand = scale(connected, secondLevel ?? 1);
      } else {
        // 100 % below the SMDB, and at sources / ATS: what they feed plus their own load.
        demand = ownLines(e)
          .map(lineKw)
          .reduce(
            add,
            sub.reduce((d, s) => add(d, s.demand), zero()),
          );
      }
    } else if (BOARDS.has(e.kind)) {
      // Once at this board, per load type: a panel override (D-03) or the Page 1 factor.
      demand = zero();
      for (const [code, kw] of Object.entries(byType) as [LoadTypeCode, PhaseKw][]) {
        const override = 'demandFactorOverrides' in e ? e.demandFactorOverrides[code] : undefined;
        const df = override ?? factors[code].value;
        if (df === null) tbc.add(code);
        demand = add(demand, scale(kw, df ?? 1));
      }
    } else {
      // Sources, ATS and load points carry the maximum demand of what they feed, plus their own
      // entered load in full; its demand factor is applied once, at the board above (10.3).
      demand = ownLines(e)
        .map(lineKw)
        .reduce(
          add,
          sub.reduce((d, s) => add(d, s.demand), zero()),
        );
    }

    // Power factor: the DB's own for all its loads, else each line's load type; for a sum, the
    // equivalent pf from P and Q. A load without any power factor leaves none (never assumed, V-14).
    const entered = ownPf(e);
    const lines = ownLines(e).map((l) => ({
      kw: total(lineKw(l)),
      pf: entered ?? typePf(l.loadType),
    }));
    const missing =
      lines.some((l) => l.kw > 0 && !l.pf) || sub.some((x) => x.connectedKw > 0 && !x.pf);
    const p = total(connected);
    const q =
      lines.reduce((s, l) => s + reactive(l.kw, l.pf), 0) + sub.reduce((s, x) => s + x.q, 0);
    // One power factor for all own lines (no boards below): that value exactly, no rounding noise.
    const single = new Set(lines.filter((l) => l.kw > 0).map((l) => l.pf));
    const pf = missing
      ? null
      : sub.length === 0 && (entered !== null || single.size === 1)
        ? (entered ?? [...single][0]!)
        : p > 0
          ? p / Math.hypot(p, q)
          : (entered ?? defaultPf);
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
      byCategory,
      tbcFactors: LoadTypeCodeSchema.options.filter((c) => tbc.has(c)),
      tbcCategories: DemandCategorySchema.options.filter((c) => tbcCat.has(c)),
      incomplete: [
        ...(e.kind === 'equipment' && equipmentInputKw(e) === null ? [e.tag] : []),
        ...(starterInputFactor(e) === null && ownLines(e).length > 0 ? [e.tag] : []),
        ...sub.flatMap((x) => x.incomplete),
      ],
      q,
    };
    out.set(e.id, summary);
    return summary;
  };
  for (const e of elements) visit(e, new Set());
  return new Map([...out].map(([id, { q: _q, ...s }]) => [id, s]));
}

/** Manual method only: category factors entered but not applied (A-15). */
export const categoryFactorsPending = (project: Pick<Project, 'calculation'>) =>
  project.calculation.demandMethod === 'manual' &&
  Object.values(project.calculation.demandFactors.byCategory).some((f) => f.value !== null);
