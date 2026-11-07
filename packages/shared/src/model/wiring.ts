import { CableSchema, type Cable, type CableConstruction } from './cable.js';
import type { Element, ModelPoint } from './elements.js';
import type { Riser } from './riser.js';

/**
 * Cable drawing rules (FR-15, #TASK-13): ports, orthogonal routes, length, outgoing ways and
 * cable tags. Topology rules (which element may feed which) follow with #TASK-14.
 */

export type Port = Cable['from']['port'];

/**
 * Ports of each kind. Any component may feed or be fed (A-20, 7 Nov 2026): a feeder runs from
 * the component clicked first to the one clicked second. An ATS has a normal and a standby input
 * (the first and the second feeder into it). Equipment is linked to its isolator through
 * "Fed from", not by a feeder (A-17).
 */
export function portsOf(e: Pick<Element, 'kind'>): Port[] {
  switch (e.kind) {
    case 'ats':
      return ['normal', 'standby', 'out'];
    case 'equipment':
      return [];
    default:
      return ['in', 'out'];
  }
}

export const isOutput = (p: Port) => p === 'out';

/** Why a cable may not run from one port to another, or null when it may. */
export function connectionProblem(
  from: { element: Element; port: Port },
  to: { element: Element; port: Port },
): string | null {
  if (from.element.id === to.element.id)
    return 'A cable cannot start and end on the same component.';
  if (from.element.floorId !== to.element.floorId) {
    return 'Both ends must be on this floor; floors are connected through the risers.';
  }
  return null;
}

// ----- routes -------------------------------------------------------------------------------------

/** The next route point, kept horizontal or vertical from the previous one (orthogonal routing). */
export function orthogonal(prev: ModelPoint, p: ModelPoint): ModelPoint {
  return Math.abs(p.x - prev.x) >= Math.abs(p.y - prev.y)
    ? { x: p.x, y: prev.y }
    : { x: prev.x, y: p.y };
}

/** Closes a route on its end point, adding an elbow when the last leg is not straight. */
export function closeRoute(points: ModelPoint[], end: ModelPoint): ModelPoint[] {
  const last = points.at(-1)!;
  if (last.x === end.x || last.y === end.y) return [...points, end];
  return [...points, { x: end.x, y: last.y }, end];
}

/** A cable whose component moved: the end follows, with an elbow if a leg would turn diagonal. */
export function moveCableEnd<T extends Pick<Cable, 'route'>>(
  cable: T,
  end: 'from' | 'to',
  p: ModelPoint,
): T {
  if (end === 'to') return { ...cable, route: closeRoute(cable.route.slice(0, -1), p) };
  const reversed = closeRoute([...cable.route].reverse().slice(0, -1), p);
  return { ...cable, route: reversed.reverse() };
}

const segmentsLength = (route: ModelPoint[]) =>
  route.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - route[i]!.x, p.y - route[i]!.y), 0);

/** Vertical run added to every cable for the Z direction (A-05). */
export const VERTICAL_RUN_M = 1;

/** How a cable's length is built from its measured route (rule pack, 12.2). */
export interface LengthRule {
  /** Percentage added to route + addition (0 since 3 Nov 2026). */
  allowancePct: number;
  /** Fixed length added to every measured cable (5 m since 3 Nov 2026); null = the cable's own vertical run (A-05, 1 m). */
  additionM: number | null;
}

/**
 * Cable length (A-05 as amended 3 Nov 2026): the routed length measured on the plan, plus a fixed
 * addition per cable (5 m in the Dubai pack, replacing 1 m + 10 %), plus any percentage allowance.
 */
export function cableLength(
  cable: Pick<Cable, 'route' | 'verticalM'>,
  rule: LengthRule,
): { routedM: number; additionM: number; allowanceM: number; totalM: number } {
  const routedM = segmentsLength(cable.route);
  const additionM = rule.additionM ?? cable.verticalM;
  const allowanceM = ((routedM + additionM) * rule.allowancePct) / 100;
  return { routedM, additionM, allowanceM, totalM: routedM + additionM + allowanceM };
}

// ----- outgoing ways and tags ---------------------------------------------------------------------

/** The smallest free way number on a board (from the circuit references of its outgoing cables). */
export function nextWay(cables: readonly Cable[], sourceId: string): number {
  const used = new Set(
    cables
      .filter((c) => c.from.elementId === sourceId)
      .map((c) => Number.parseInt(c.circuitRef, 10))
      .filter(Number.isFinite),
  );
  let way = 1;
  while (used.has(way)) way += 1;
  return way;
}

/** Phases of a way: three-phase unless the fed board is single-phase (SPN / SP: red phase). */
export function phasesFor(target: Element): 'RYB' | 'R' {
  const poles = 'poles' in target ? target.poles : null;
  return poles === 'SPN' || poles === 'SP' ? 'R' : 'RYB';
}

/**
 * Cable tag F<floor>-<hierarchy> (12.4, OI-24): the way numbers from the top of the chain, e.g.
 * F2-3-1 = way 1 of the board fed by way 3. Built from the cable feeding the source board.
 */
export function cableTag(
  cables: readonly Cable[],
  sourceId: string,
  way: number,
  floorCode: string,
): string {
  const feeding = cables.find((c) => c.to.elementId === sourceId);
  const above = feeding?.tag.match(/^F[^-]+-(.+)$/)?.[1];
  const base = `F${floorCode}-${above ? `${above}-${way}` : way}`;
  const taken = new Set(cables.map((c) => c.tag));
  let tag = base;
  for (let n = 2; taken.has(tag); n++) tag = `${base}/${n}`;
  return tag;
}

/** A new cable between two ports along a route (metres), as drawn (FR-15). */
export function drawCable(args: {
  id: string;
  cables: readonly Cable[];
  from: { element: Element; port: Port };
  to: { element: Element; port: Port };
  route: ModelPoint[];
  floorCode: string;
  construction: CableConstruction;
}): Cable {
  const way = nextWay(args.cables, args.from.element.id);
  return CableSchema.parse({
    id: args.id,
    version: 0,
    tag: cableTag(args.cables, args.from.element.id, way, args.floorCode),
    from: { elementId: args.from.element.id, port: args.from.port },
    to: { elementId: args.to.element.id, port: args.to.port },
    circuitRef: `${way}${phasesFor(args.to.element)}`,
    floorId: args.from.element.floorId,
    route: args.route,
    verticalM: VERTICAL_RUN_M,
    construction: args.construction,
    locks: { sizeMm2: null, runs: null, eccMm2: null },
  });
}

/** The tag of the component feeding an element (Engineering Property "Fed From"), or null. */
export function fedFrom(
  element: Pick<Element, 'id'>,
  model: { elements: readonly Element[]; cables: readonly Cable[]; risers?: readonly Riser[] },
): string | null {
  const riser = model.risers?.findIndex((r) => r.feeds.includes(element.id)) ?? -1;
  if (riser >= 0) return `Riser ${riser + 1}`;
  const incoming = model.cables.filter((c) => c.to.elementId === element.id);
  if (incoming.length === 0) return null;
  return incoming
    .map((c) => model.elements.find((e) => e.id === c.from.elementId)?.tag ?? '?')
    .join(', ');
}
