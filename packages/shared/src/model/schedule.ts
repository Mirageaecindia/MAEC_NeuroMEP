import type { Project } from '../project/schema.js';
import type { Cable } from './cable.js';
import type { Element, ElementKind } from './elements.js';
import type { LoadSummary } from './loads.js';
import { inputsKey, resultOf, type StoredResult } from './sizing.js';
import { cableLength, type LengthRule } from './wiring.js';

/**
 * Schematic tree and panel schedules from the network model (WBS 1.5.3 / 1.7.2, #TASK-30 /
 * #TASK-31, Section 14). Calculated columns (breaker, fault duty, size, ECC) come from the last
 * Cable Size result; loads come from the live load table.
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
  /**
   * Other supplies into this component (manager feedback, 7 Nov 2026): e.g. a generator feeding
   * an EMDB that the transformer also feeds. Drawn as extra incomers, not followed further.
   */
  incomers: {
    from: Element;
    via: { kind: 'feeder'; cable: Cable } | { kind: 'riser'; riser: number };
  }[];
}

/** Tree from a source down to the DBs (Section 14): feeders, then riser tap-offs. */
export function sldTree(model: Project['model'], rootId: string): SldNode | null {
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const build = (element: Element, via: SldNode['via'], parentId: string | null): SldNode => {
    seen.add(element.id);
    const children: SldNode[] = [];
    const incomers: SldNode['incomers'] = [];
    for (const cable of model.cables) {
      const from = byId.get(cable.from.elementId);
      if (cable.to.elementId === element.id && from && from.id !== parentId) {
        incomers.push({ from, via: { kind: 'feeder', cable } });
      }
    }
    model.risers.forEach((r, i) => {
      const from = r.fedFromId ? byId.get(r.fedFromId) : undefined;
      if (r.feeds.includes(element.id) && from && from.id !== parentId) {
        incomers.push({ from, via: { kind: 'riser', riser: i + 1 } });
      }
    });
    for (const cable of model.cables) {
      const child = byId.get(cable.to.elementId);
      if (cable.from.elementId === element.id && child && !seen.has(child.id)) {
        children.push(build(child, { kind: 'feeder', cable }, element.id));
      }
    }
    model.risers.forEach((r, i) => {
      if (r.fedFromId !== element.id) return;
      for (const id of r.feeds) {
        const child = byId.get(id);
        if (child && !seen.has(id)) {
          children.push(build(child, { kind: 'riser', riser: i + 1 }, element.id));
        }
      }
    });
    return { element, via, children, incomers };
  };
  const root = byId.get(rootId);
  return root ? build(root, null, null) : null;
}

// ----- Panel schedule ------------------------------------------------------------------------

/** One row of a schedule: an incomer or an outgoing way (Section 14 columns). */
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
  /** Earth leakage of the circuit, motor starter (MCC schedule), tap-off or standby input. */
  remarks: string;
  /** Why the row's result blocks an export (E3101): blocked or a failing check; null if none. */
  problem: string | null;
  /**
   * Meter components linked to the component this row feeds (10 Nov 2026), by type: the
   * "Proposed type & No of Meters" columns, acquired from the plan; null when none is placed
   * (the engineer may type the numbers in the preview, optional).
   */
  meters: MeterCounts | null;
}

/** Meters of a schedule row by type (components workbook: 1-Ph / 3-Ph / LV/HV). */
export interface MeterCounts {
  ph1: number;
  ph3: number;
  lvhv: number;
}

/** Meters (with a type) linked to a component; null when there are none. */
export function metersOn(
  elements: readonly Element[],
  id: string | null | undefined,
): MeterCounts | null {
  if (!id) return null;
  const linked = elements.filter((e) => e.kind === 'meter' && e.meteredId === id && e.meterType);
  if (linked.length === 0) return null;
  const count = (t: string) => linked.filter((m) => m.kind === 'meter' && m.meterType === t).length;
  return { ph1: count('1-Ph'), ph3: count('3-Ph'), lvhv: count('LV/HV') };
}

export interface BoardSchedule {
  /** The board, or the riser of a busbar schedule. */
  id: string;
  tag: string;
  kind: 'board' | 'busbar';
  /** Busbar schedule: "<tag> - <A> A TPN+E" (Section 14); null for a board. */
  description: string | null;
  project: string;
  location: string;
  /** What feeds the board (e.g. "MDB-GF-01" or "Riser 1") and the transformer upstream. */
  connectedTo: string | null;
  transformer: string | null;
  /** Incomers 1 - 2: a board fed through both inputs of an ATS has two. */
  incomers: ScheduleRow[];
  ways: ScheduleRow[];
  totals: { kw: { R: number; Y: number; B: number }; tclKw: number; mdKw: number };
  /** Maximum demand / total connected (shown "DEMAND FACTOR"); null without load. */
  demandFactor: number | null;
  /** Any calculated column comes from a run that is out of date or not run yet. */
  sizesPending: boolean;
}

type Columns = Pick<
  ScheduleRow,
  'breakerA' | 'faultDutyKa' | 'cores' | 'type' | 'sizeMm2' | 'eccMm2' | 'lengthM'
>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The last result of an item (feeder, tap-off board or riser) and whether it is usable. */
function lastResult(p: Project, id: string, key: string) {
  const found = resultOf(p, id, key);
  const result: StoredResult | undefined = found?.result;
  const failing = result
    ? (Object.entries(result.checks) as [string, { state: string }][])
        .filter(([, c]) => c.state === 'fail')
        .map(([code]) => code)
    : [];
  const problem =
    result?.status === 'blocked'
      ? `blocked ${result.errors.join(', ')}`.trim()
      : failing.length
        ? `${failing.join(', ')} failing`
        : null;
  return {
    result,
    pending: !found || found.outOfDate || result?.status === 'awaiting-load',
    problem,
  };
}

/** Breaker, fault duty and cable columns of a feeder from its last Cable Size result. */
function feederColumns(p: Project, cable: Cable, length: LengthRule, key: string) {
  const { result: r, pending, problem } = lastResult(p, cable.id, key);
  const busbar = cable.feederType === 'busbar';
  const cols: Columns = {
    breakerA: r?.device?.ratingA ?? null,
    faultDutyKa: r?.device?.faultRatingKa ?? null,
    cores: busbar ? 'TPN+E' : `${r?.size ? `${r.size.runs} x ` : ''}${cable.construction.cores}`,
    type: busbar
      ? `Busbar ${cable.busbar?.conductor ?? 'Cu'} ${r?.values.izA ?? '-'} A`
      : cable.construction.insulation,
    sizeMm2: r?.size?.sizeMm2 ?? null,
    eccMm2: r?.size?.eccMm2 ?? null,
    lengthM: round2(cableLength(cable, length).totalM),
  };
  return { cols, pending: pending || (!busbar && !r?.size), problem };
}

/** A tap-off box: its breaker, no cable (Section 14 "outgoing ratings from tap-off boxes"). */
function tapOffColumns(p: Project, boardId: string, key: string) {
  const { result: r, pending, problem } = lastResult(p, boardId, key);
  const cols: Columns = {
    breakerA: r?.device?.ratingA ?? null,
    faultDutyKa: r?.device?.faultRatingKa ?? null,
    cores: '-',
    type: 'Tap-off box',
    sizeMm2: null,
    eccMm2: null,
    lengthM: null,
  };
  return { cols, pending, problem };
}

const loadColumns = (s: LoadSummary | undefined) => ({
  kw: {
    R: round2(s?.connected.L1 ?? 0),
    Y: round2(s?.connected.L2 ?? 0),
    B: round2(s?.connected.L3 ?? 0),
  },
  tclKw: round2(s?.connectedKw ?? 0),
  mdKw: round2(s?.maxDemandKw ?? 0),
});

const polesOf = (e: Element | undefined): 'SP' | 'TP' =>
  e && 'poles' in e && e.poles === 'SPN' ? 'SP' : 'TP';

/** Remarks of a circuit (Section 14): earth leakage of the fed component, motor starter. */
function remarksOf(e: Element | undefined): string {
  const parts: string[] = [];
  if (e && 'earthLeakage' in e && e.earthLeakage && e.earthLeakage !== 'none') {
    parts.push(e.earthLeakage);
  }
  if (e?.kind === 'motor' && e.starter) {
    parts.push(e.starter === 'star-delta' ? 'Star-delta (two cable sets)' : e.starter);
  }
  return parts.join('; ');
}

/** The transformer at the top of the supply path of a component. */
function transformerAbove(model: Project['model'], id: string | null): string | null {
  const parentOf = (x: string): string | null =>
    model.cables.find((c) => c.to.elementId === x)?.from.elementId ??
    model.risers.find((r) => r.feeds.includes(x))?.fedFromId ??
    null;
  for (let cur = id, n = 0; cur && n < 50; cur = parentOf(cur), n++) {
    const e = model.elements.find((x) => x.id === cur);
    if (e?.kind === 'transformer') return e.tag;
  }
  return null;
}

const demandFactorOf = (tcl: number, md: number) => (tcl > 0 ? round2(md / tcl) : null);

/** The schedule of a board, in the company format (Figma screen 5, Section 14). */
export function boardSchedule(
  p: Project,
  boardId: string,
  summaries: Map<string, LoadSummary>,
  length: LengthRule,
): BoardSchedule | null {
  const { elements, cables, risers } = p.model;
  const board = elements.find((e) => e.id === boardId);
  if (!board) return null;
  const key = inputsKey(p);
  const tagOf = (id: string | null | undefined) => elements.find((e) => e.id === id)?.tag ?? null;
  const s = summaries.get(board.id);
  let pending = false;

  // Incomers: the feeders into the board (normal input first), else its riser tap-off box.
  const inCables = cables
    .filter((c) => c.to.elementId === board.id)
    .sort((a, b) => Number(a.to.port === 'standby') - Number(b.to.port === 'standby'));
  const riser = risers.findIndex((r) => r.feeds.includes(board.id));
  const incomers = inCables.map((c, i): ScheduleRow => {
    const { cols, pending: wait, problem } = feederColumns(p, c, length, key);
    pending ||= wait;
    return {
      problem,
      feeder: inCables.length > 1 ? `INCOMER ${i + 1}` : 'INCOMER',
      wayNo: '-',
      poles: polesOf(board),
      ...cols,
      ...loadColumns(s),
      remarks: c.to.port === 'standby' ? `Standby from ${tagOf(c.from.elementId) ?? '?'}` : '',
      meters: metersOn(elements, board.id),
    };
  });
  if (incomers.length === 0) {
    const tapOff = riser >= 0 ? tapOffColumns(p, board.id, key) : null;
    pending ||= tapOff?.pending ?? false;
    incomers.push({
      problem: tapOff?.problem ?? null,
      feeder: 'INCOMER',
      wayNo: '-',
      poles: polesOf(board),
      ...(tapOff?.cols ?? {
        breakerA: null,
        faultDutyKa: null,
        cores: '-',
        type: '-',
        sizeMm2: null,
        eccMm2: null,
        lengthM: null,
      }),
      ...loadColumns(s),
      remarks: riser >= 0 ? `Tap-off from Riser ${riser + 1}` : '',
      meters: metersOn(elements, board.id),
    });
  }

  const ways = cables
    .filter((c) => c.from.elementId === board.id)
    .sort((a, b) => a.circuitRef.localeCompare(b.circuitRef, undefined, { numeric: true }))
    .map((c): ScheduleRow => {
      const child = elements.find((e) => e.id === c.to.elementId);
      const { cols, pending: wait, problem } = feederColumns(p, c, length, key);
      pending ||= wait;
      return {
        problem,
        feeder: child?.tag ?? '?',
        wayNo: c.circuitRef,
        poles: polesOf(child),
        ...cols,
        ...loadColumns(summaries.get(c.to.elementId)),
        remarks: remarksOf(child),
        meters: metersOn(elements, child?.id),
      };
    });

  const totals = loadColumns(s);
  return {
    id: board.id,
    tag: board.tag,
    kind: 'board',
    description: null,
    project: p.details.name,
    location: board.location,
    connectedTo: inCables.length
      ? inCables.map((c) => tagOf(c.from.elementId)).join(' / ')
      : riser >= 0
        ? `Riser ${riser + 1}`
        : null,
    transformer: transformerAbove(p.model, board.id),
    incomers,
    ways,
    totals,
    demandFactor: demandFactorOf(totals.tclKw, totals.mdKw),
    sizesPending: pending,
  };
}

/**
 * Busbar schedule of a riser (Section 14): "<tag> - <A> A TPN+E"; the incomer from the board that
 * feeds it, and one way per board on its tap-offs with the tap-off box breaker.
 */
export function busbarSchedule(
  p: Project,
  riserId: string,
  summaries: Map<string, LoadSummary>,
): BoardSchedule | null {
  const { elements, risers } = p.model;
  const index = risers.findIndex((r) => r.id === riserId);
  const riser = risers[index];
  if (!riser) return null;
  const key = inputsKey(p);
  const tag = `Riser ${index + 1}`;
  const own = lastResult(p, riser.id, key);
  const rating = own.result?.values.izA ?? null;
  let pending = own.pending;

  const boards = riser.feeds
    .map((id) => elements.find((e) => e.id === id))
    .filter((e): e is Element => !!e);
  const ways = boards.map((b, k): ScheduleRow => {
    const { cols, pending: wait, problem } = tapOffColumns(p, b.id, key);
    pending ||= wait;
    return {
      problem,
      feeder: b.tag,
      wayNo: `T${k + 1}`,
      poles: polesOf(b),
      ...cols,
      ...loadColumns(summaries.get(b.id)),
      remarks: remarksOf(b),
      meters: metersOn(elements, b.id),
    };
  });
  const add = (f: (r: ScheduleRow) => number) => round2(ways.reduce((t, w) => t + f(w), 0));
  const totals = {
    kw: { R: add((w) => w.kw.R), Y: add((w) => w.kw.Y), B: add((w) => w.kw.B) },
    tclKw: add((w) => w.tclKw),
    mdKw: add((w) => w.mdKw),
  };
  const source = elements.find((e) => e.id === riser.fedFromId);
  return {
    id: riser.id,
    tag,
    kind: 'busbar',
    description: `${tag} - ${rating ?? '-'} A TPN+E`,
    project: p.details.name,
    location: '',
    connectedTo: source?.tag ?? null,
    transformer: transformerAbove(p.model, riser.fedFromId),
    incomers: [
      {
        feeder: 'INCOMER',
        wayNo: '-',
        poles: 'TP',
        breakerA: own.result?.values.inA ?? null,
        faultDutyKa: null,
        cores: 'TPN+E',
        type: `Busbar ${rating ?? '-'} A`,
        sizeMm2: null,
        eccMm2: null,
        lengthM: riser.lengthM,
        ...totals,
        remarks: source ? `From ${source.tag}` : 'Not fed',
        problem: own.problem,
        meters: null,
      },
    ],
    ways,
    totals,
    demandFactor: demandFactorOf(totals.tclKw, totals.mdKw),
    sizesPending: pending,
  };
}

/**
 * What stops the export of these schedules (E3101): results out of date or not run, blocked
 * results and failing checks - one line per board or row.
 */
export function exportProblems(schedules: readonly BoardSchedule[]): string[] {
  return schedules.flatMap((s) => [
    ...(s.sizesPending ? [`${s.tag}: results out of date or not calculated`] : []),
    ...[...s.incomers, ...s.ways].flatMap((r) =>
      r.problem ? [`${s.tag} ${r.feeder === 'INCOMER' ? 'incomer' : r.feeder}: ${r.problem}`] : [],
    ),
  ]);
}
