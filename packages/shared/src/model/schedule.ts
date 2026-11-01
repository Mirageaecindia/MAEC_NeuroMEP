import type { Project } from '../project/schema.js';
import type { Cable } from './cable.js';
import type { Element, ElementKind } from './elements.js';
import type { LoadSummary } from './loads.js';
import { resultOf } from './sizing.js';
import { cableLength } from './wiring.js';

/**
 * Schematic tree and panel schedules from the network model (WBS 1.5.3, #TASK-30 / #TASK-31,
 * Section 14). Calculated columns (breaker, fault duty, size, ECC) come from the last Cable Size
 * result and are null until the engine fills them (WBS 1.6); loads come from the live load table.
 */

/** Report Library levels (Figma screen 5, decision 2 Nov 2026). */
export const SCHEDULE_LEVELS = {
  first: ['lv-panel', 'mdb', 'emdb', 'acb-panel'],
  second: ['smdb', 'esmdb', 'mcc', 'emcc'],
  floor: ['db'],
} as const satisfies Record<string, readonly ElementKind[]>;
export type ScheduleLevel = keyof typeof SCHEDULE_LEVELS;

export const scheduleLevelOf = (kind: ElementKind): ScheduleLevel | null =>
  (Object.keys(SCHEDULE_LEVELS) as ScheduleLevel[]).find((l) =>
    (SCHEDULE_LEVELS[l] as readonly ElementKind[]).includes(kind),
  ) ?? null;

// ----- Single-line diagram tree --------------------------------------------------------------

/** A node of the single-line diagram: a component and how it is fed (feeder or riser). */
export interface SldNode {
  element: Element;
  /** The feeder or riser number that feeds it; null for the root. */
  via: { kind: 'feeder'; cable: Cable } | { kind: 'riser'; riser: number } | null;
  children: SldNode[];
}

/** Tree from a source down to the DBs (Section 14): feeders, then riser tap-offs. */
export function sldTree(model: Project['model'], rootId: string): SldNode | null {
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const build = (element: Element, via: SldNode['via']): SldNode => {
    seen.add(element.id);
    const children: SldNode[] = [];
    for (const cable of model.cables) {
      const child = byId.get(cable.to.elementId);
      if (cable.from.elementId === element.id && child && !seen.has(child.id)) {
        children.push(build(child, { kind: 'feeder', cable }));
      }
    }
    model.risers.forEach((r, i) => {
      if (r.fedFromId !== element.id) return;
      for (const id of r.feeds) {
        const child = byId.get(id);
        if (child && !seen.has(id)) children.push(build(child, { kind: 'riser', riser: i + 1 }));
      }
    });
    return { element, via, children };
  };
  const root = byId.get(rootId);
  return root ? build(root, null) : null;
}

// ----- Panel schedule ------------------------------------------------------------------------

/** One row of a schedule: the incomer or an outgoing way (Section 14 columns). */
export interface ScheduleRow {
  feeder: string;
  wayNo: string;
  poles: 'SP' | 'TP';
  breakerA: number | null;
  faultDutyKa: number | null;
  cores: string;
  type: string;
  sizeMm2: number | null;
  eccMm2: number | null;
  lengthM: number | null;
  kw: { R: number; Y: number; B: number };
  tclKw: number;
  mdKw: number;
}

export interface BoardSchedule {
  board: Element;
  project: string;
  location: string;
  /** What feeds the board (e.g. "MDB-GF-01" or "Riser 1") and the transformer upstream. */
  connectedTo: string | null;
  transformer: string | null;
  incomer: ScheduleRow;
  ways: ScheduleRow[];
  totals: { kw: { R: number; Y: number; B: number }; tclKw: number; mdKw: number };
  /** Maximum demand / total connected (shown "DEMAND FACTOR"); null without load. */
  demandFactor: number | null;
  /** Any calculated column comes from a run that is out of date or not run yet. */
  sizesPending: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function feederColumns(p: Project, cable: Cable | undefined, allowancePct: number) {
  const found = cable ? resultOf(p, cable.id) : null;
  const r = found?.result;
  return {
    breakerA: r?.device?.ratingA ?? null,
    faultDutyKa: r?.device?.faultRatingKa ?? null,
    cores: cable
      ? cable.feederType === 'busbar'
        ? 'TPN+E'
        : `${r?.size ? `${r.size.runs} x ` : ''}${cable.construction.cores}`
      : '-',
    type: cable
      ? cable.feederType === 'busbar'
        ? `Busbar ${cable.busbar?.conductor ?? 'Cu'}`
        : cable.construction.insulation
      : '-',
    sizeMm2: r?.size?.sizeMm2 ?? null,
    eccMm2: r?.size?.eccMm2 ?? null,
    lengthM: cable ? round2(cableLength(cable, allowancePct).totalM) : null,
    pending: !found || found.outOfDate || !r?.size,
  };
}

const kwOf = (s: LoadSummary | undefined) => ({
  R: round2(s?.connected.L1 ?? 0),
  Y: round2(s?.connected.L2 ?? 0),
  B: round2(s?.connected.L3 ?? 0),
});

/** The schedule of a board, in the company format (Figma screen 5, Section 14). */
export function boardSchedule(
  p: Project,
  boardId: string,
  summaries: Map<string, LoadSummary>,
  allowancePct: number,
): BoardSchedule | null {
  const { elements, cables, risers } = p.model;
  const board = elements.find((e) => e.id === boardId);
  if (!board) return null;
  const tagOf = (id: string | null | undefined) => elements.find((e) => e.id === id)?.tag ?? null;
  const polesOf = (e: Element | undefined): 'SP' | 'TP' =>
    e && 'poles' in e && e.poles === 'SPN' ? 'SP' : 'TP';

  const inCable = cables.find((c) => c.to.elementId === board.id);
  const riser = risers.findIndex((r) => r.feeds.includes(board.id));
  const s = summaries.get(board.id);
  const inCols = feederColumns(p, inCable, allowancePct);
  const incomer: ScheduleRow = {
    feeder: 'INCOMER',
    wayNo: '-',
    poles: polesOf(board),
    ...inCols,
    kw: kwOf(s),
    tclKw: round2(s?.connectedKw ?? 0),
    mdKw: round2(s?.maxDemandKw ?? 0),
  };
  const out = cables
    .filter((c) => c.from.elementId === board.id)
    .sort((a, b) => a.circuitRef.localeCompare(b.circuitRef, undefined, { numeric: true }));
  let pending = inCols.pending;
  const ways = out.map((c): ScheduleRow => {
    const child = elements.find((e) => e.id === c.to.elementId);
    const cs = summaries.get(c.to.elementId);
    const cols = feederColumns(p, c, allowancePct);
    pending ||= cols.pending;
    return {
      feeder: child?.tag ?? '?',
      wayNo: c.circuitRef,
      poles: polesOf(child),
      ...cols,
      kw: kwOf(cs),
      tclKw: round2(cs?.connectedKw ?? 0),
      mdKw: round2(cs?.maxDemandKw ?? 0),
    };
  });

  // Upstream: the feeding board or riser, and the transformer at the top of the path.
  const parentOf = (id: string): string | null =>
    cables.find((c) => c.to.elementId === id)?.from.elementId ??
    risers.find((r) => r.feeds.includes(id))?.fedFromId ??
    null;
  let transformer: string | null = null;
  for (let id = parentOf(board.id), n = 0; id && n < 50; id = parentOf(id), n++) {
    const e = elements.find((x) => x.id === id);
    if (e?.kind === 'transformer') {
      transformer = e.tag;
      break;
    }
  }

  const tcl = s?.connectedKw ?? 0;
  return {
    board,
    project: p.details.name,
    location: board.location,
    connectedTo: inCable ? tagOf(inCable.from.elementId) : riser >= 0 ? `Riser ${riser + 1}` : null,
    transformer,
    incomer,
    ways,
    totals: { kw: kwOf(s), tclKw: round2(tcl), mdKw: round2(s?.maxDemandKw ?? 0) },
    demandFactor: tcl > 0 ? round2((s?.maxDemandKw ?? 0) / tcl) : null,
    sizesPending: pending,
  };
}
