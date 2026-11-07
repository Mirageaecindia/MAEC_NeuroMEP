import type { Project } from '../project/schema.js';
import type { LoadSummary } from './loads.js';
import { suppliedIn } from './network.js';

/**
 * Transformer loading and plot allocation (design doc 10.15; briefing page 9, 6 Nov 2026), live
 * from the load summaries: loading = maximum demand (kVA) / rating, a warning above the loading
 * limit (E2801); the maximum demand of the whole project - every transformer, not one - compared
 * with the plot load allocation (E2802).
 */

export interface TransformerLoading {
  id: string;
  tag: string;
  ratingKva: number | null;
  /** Rating x the loading limit. */
  limitKva: number | null;
  demandKva: number | null;
  /** Maximum demand / rating (%). */
  loadedPct: number | null;
  over: boolean;
}

export interface CapacitySummary {
  limitPct: number;
  /** Connected load that reaches a transformer or generator (manager feedback, 7 Nov 2026). */
  connectedKva: number;
  /** Load entered on components with no supply path yet: shown apart, not in Loaded. */
  notConnected: { kva: number; count: number };
  demandKw: number;
  demandKva: number;
  /** Installed transformer kVA x the limit, else the plot allocation (kVA) until one is placed. */
  allowableKva: number | null;
  /** Maximum demand / installed kVA (or the plot allocation without transformers), %. */
  loadedPct: number | null;
  transformers: TransformerLoading[];
  /** The project's maximum demand in the plot allocation's unit; null without an allocation. */
  plot: { allocation: number; unit: 'kW' | 'kVA'; demand: number; over: boolean } | null;
}

const kva = (kw: number, pf: number | null) => (pf ? kw / pf : null);

/**
 * The project's top-level items: each load counted once. A load reaches the transformers through
 * an ATS, so the generator side is left out (a board fed only by a generator counts on its own);
 * boards on a riser tap-off count under the riser's source.
 */
function topLevel(project: Pick<Project, 'model'>) {
  const { elements, cables, risers } = project.model;
  const kind = new Map(elements.map((e) => [e.id, e.kind]));
  const normal = new Set(
    cables
      .filter((c) => kind.get(c.from.elementId) !== 'generator' && c.to.port !== 'standby')
      .map((c) => c.to.elementId),
  );
  for (const r of risers ?? []) if (r.fedFromId) for (const id of r.feeds) normal.add(id);
  for (const e of elements) if (e.kind === 'equipment' && e.fedFromId) normal.add(e.id);
  return elements.filter((e) => e.kind !== 'generator' && !normal.has(e.id));
}

export function capacitySummary(
  project: Pick<Project, 'model' | 'details'>,
  summaries: ReadonlyMap<string, LoadSummary>,
  options: { limitPct: number; defaultPf: number | null },
): CapacitySummary {
  const { limitPct, defaultPf } = options;
  // Only loads with a supply path count as connected (normal or standby).
  const network = project.model;
  const supplied = new Set([...suppliedIn(network, 'normal'), ...suppliedIn(network, 'standby')]);
  const all = topLevel(project).flatMap((e) => {
    const s = summaries.get(e.id);
    return s ? [{ s, on: supplied.has(e.id) }] : [];
  });
  const tops = all.filter((t) => t.on).map((t) => t.s);
  const off = all.filter((t) => !t.on && t.s.connectedKw > 0).map((t) => t.s);
  const total = (list: LoadSummary[], f: (s: LoadSummary) => number | null) =>
    list.reduce((t, s) => t + (f(s) ?? 0), 0);
  const sum = (f: (s: LoadSummary) => number | null) => total(tops, f);
  const connectedKva = sum((s) => kva(s.connectedKw, s.pf));
  const demandKw = sum((s) => s.maxDemandKw);
  const demandKva = sum((s) => kva(s.maxDemandKw, s.pf));
  const notConnected = { kva: total(off, (s) => kva(s.connectedKw, s.pf)), count: off.length };

  const transformers = project.model.elements.flatMap((e): TransformerLoading[] => {
    if (e.kind !== 'transformer') return [];
    const s = summaries.get(e.id);
    const demand = s ? kva(s.maxDemandKw, s.pf) : null;
    const limit = e.kva ? (e.kva * limitPct) / 100 : null;
    return [
      {
        id: e.id,
        tag: e.tag,
        ratingKva: e.kva,
        limitKva: limit,
        demandKva: demand,
        loadedPct: e.kva && demand !== null ? (demand / e.kva) * 100 : null,
        over: limit !== null && demand !== null && demand > limit,
      },
    ];
  });
  const installed = transformers.reduce((t, x) => t + (x.ratingKva ?? 0), 0);

  const p = project.details.plotLoad;
  const plotKva = p.value === null ? null : p.unit === 'kVA' ? p.value : kva(p.value, defaultPf);
  const plotDemand = p.unit === 'kW' ? demandKw : demandKva;
  const allowableKva = installed > 0 ? (installed * limitPct) / 100 : plotKva;
  const base = installed > 0 ? installed : plotKva;
  return {
    limitPct,
    connectedKva,
    notConnected,
    demandKw,
    demandKva,
    allowableKva,
    loadedPct: base ? (demandKva / base) * 100 : null,
    transformers,
    plot:
      p.value === null
        ? null
        : { allocation: p.value, unit: p.unit, demand: plotDemand, over: plotDemand > p.value },
  };
}
