import type { Project } from '../project/schema.js';
import { CableSchema, type Cable } from './cable.js';
import { ElementSchema, type Element, type ModelPoint } from './elements.js';
import { itemOfElement, nextTag } from './library.js';
import { cableTag, nextWay, phasesFor } from './wiring.js';

/**
 * Copy / paste of components and Replicate floor (user request 7 Nov 2026). A copy keeps every
 * engineering property and load of its originals and gets a new id and the next free tag on the
 * target floor (DB-GF-01 copied to floor 5 = DB-5-01). Feeders between two copied components are
 * copied too, with new ways and tags; feeders to components outside the copy are not (a component
 * has one supply). Riser tap-off links and Cable Size results are never copied. Equipment linked
 * to an isolator outside the copy loses the link (W1803 until linked again).
 */
export interface CopyResult {
  elements: Element[];
  cables: Cable[];
}

const shift = (p: ModelPoint, d: ModelPoint): ModelPoint => ({ x: p.x + d.x, y: p.y + d.y });

type PlanFloor = Pick<Project['building']['floors'][number], 'plan'>;

/**
 * Same place on the sheet (user request 8 Nov 2026): a point of one floor's plan moved to the
 * same position on another floor's plan - the same fraction of the page across and down - in
 * the target's metres (its own calibration). Floor plans of a building share the sheet layout,
 * so components land where they were drawn even when the plans were calibrated differently.
 * Null when either plan is missing or not calibrated (positions then stay in metres).
 */
export function sheetMapping(
  from: PlanFloor | undefined,
  to: PlanFloor | undefined,
): ((p: ModelPoint) => ModelPoint) | null {
  const a = from?.plan;
  const b = to?.plan;
  if (!a?.calibration || !b?.calibration) return null;
  const sx = (b.page.widthPt / a.page.widthPt) * b.calibration.metresPerUnit;
  const sy = (b.page.heightPt / a.page.heightPt) * b.calibration.metresPerUnit;
  const ma = a.calibration.metresPerUnit;
  return (p) => ({ x: (p.x / ma) * sx, y: (p.y / ma) * sy });
}

/** Copies of `ids` on `targetFloorId`, moved by `offset` metres. */
export function copyComponents(
  project: Pick<Project, 'building' | 'model'>,
  args: {
    ids: readonly string[];
    targetFloorId: string;
    offset?: ModelPoint;
    /** Source metres to target metres (`sheetMapping`); the offset is added after it. */
    map?: (p: ModelPoint) => ModelPoint;
    /** Per source floor instead of `map` (a clone gathers components from several floors). */
    mapFor?: (floorId: string) => ((p: ModelPoint) => ModelPoint) | null;
    newId: () => string;
  },
): CopyResult {
  const { elements, cables } = project.model;
  const floor = project.building.floors.find((f) => f.id === args.targetFloorId);
  if (!floor) throw new Error(`No floor ${args.targetFloorId}`);
  const offset = args.offset ?? { x: 0, y: 0 };
  const place = (p: ModelPoint, fromFloorId?: string) => {
    const m = (fromFloorId && args.mapFor?.(fromFloorId)) || args.map;
    return shift(m ? m(p) : p, offset);
  };
  const wanted = new Set(args.ids);
  const originals = elements.filter((e) => wanted.has(e.id));
  const idOf = new Map(originals.map((e) => [e.id, args.newId()]));
  const taken = elements.map((e) => e.tag);

  const copies = originals.map((e): Element => {
    const item = itemOfElement(e);
    const rule = item?.tag ?? { pattern: `${e.tag}-{n}`, source: 'proposal' as const };
    const tag = nextTag(rule, floor.code, taken);
    taken.push(tag);
    const linked =
      'fedFromId' in e
        ? { fedFromId: (e.fedFromId && idOf.get(e.fedFromId)) ?? null }
        : 'meteredId' in e
          ? { meteredId: (e.meteredId && idOf.get(e.meteredId)) ?? null }
          : {};
    return ElementSchema.parse({
      ...e,
      ...linked,
      id: idOf.get(e.id)!,
      version: 0,
      tag,
      floorId: floor.id,
      position: place(e.position, e.floorId),
    });
  });

  // Feeders inside the copy, source boards first so the tags follow the hierarchy (12.4).
  const inside = cables.filter((c) => idOf.has(c.from.elementId) && idOf.has(c.to.elementId));
  const byId = new Map(copies.map((e) => [e.id, e]));
  const all: Cable[] = [...cables];
  const made: Cable[] = [];
  const pending = [...inside];
  while (pending.length) {
    // A feeder whose source is fed by another pending feeder waits for that one.
    const i = pending.findIndex(
      (c) => !pending.some((o) => o !== c && o.to.elementId === c.from.elementId),
    );
    const c = pending.splice(i < 0 ? 0 : i, 1)[0]!;
    const from = idOf.get(c.from.elementId)!;
    const to = idOf.get(c.to.elementId)!;
    const way = nextWay(all, from);
    const copy = CableSchema.parse({
      ...c,
      id: args.newId(),
      version: 0,
      tag: cableTag(all, from, way, floor.code),
      from: { ...c.from, elementId: from },
      to: { ...c.to, elementId: to },
      circuitRef: `${way}${phasesFor(byId.get(to)!)}`,
      floorId: floor.id,
      route: c.route.map((pt) => place(pt, c.floorId)),
    });
    all.push(copy);
    made.push(copy);
  }
  return { elements: copies, cables: made };
}

/** Components of the given layers on a floor (what Replicate floor copies). */
export function floorComponents(
  project: Pick<Project, 'model'>,
  floorId: string,
  layers: readonly Element['discipline'][],
): Element[] {
  return project.model.elements.filter(
    (e) => e.floorId === floorId && layers.includes(e.discipline),
  );
}

/**
 * A component and everything downstream of it (Clone, user request 28 Nov 2026): the components
 * its feeders reach, level after level (on any floor), and the equipment and meters linked to
 * them. Riser tap-offs are not followed (risers are building-wide and never copied).
 */
export function downstreamOf(
  model: Pick<Project['model'], 'elements' | 'cables'>,
  rootId: string,
): string[] {
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of model.cables) {
      if (c.from.elementId === id && !out.has(c.to.elementId)) {
        out.add(c.to.elementId);
        stack.push(c.to.elementId);
      }
    }
  }
  for (const e of model.elements) {
    const link =
      'fedFromId' in e && e.kind === 'equipment'
        ? e.fedFromId
        : 'meteredId' in e
          ? e.meteredId
          : null;
    if (link && out.has(link)) out.add(e.id);
  }
  return model.elements.filter((e) => out.has(e.id)).map((e) => e.id);
}

/**
 * Clone (user request 28 Nov 2026): a component and its downstream onto one floor - new ids,
 * tags of the target floor (DB-B1-01 -> DB-GF-01), every property and load kept, the feeders
 * between them copied with new ways and tags. Each component lands at the same place on the
 * target sheet as on its own floor (2 m down and right when cloned onto its own floor). A feeder
 * that ran between two floors becomes a plan feeder (both ends now on one floor). The clone's
 * top component has no supply until a feeder is drawn to it. Only the given layers are copied.
 */
export function cloneComponents(
  project: Pick<Project, 'building' | 'model'>,
  args: {
    rootId: string;
    targetFloorId: string;
    layers: readonly Element['discipline'][];
    /** Feeders need the electrical layer. */
    withFeeders: boolean;
    newId: () => string;
  },
): CopyResult & { skipped: number } {
  const all = downstreamOf(project.model, args.rootId);
  const byId = new Map(project.model.elements.map((e) => [e.id, e]));
  const ids = all.filter((id) => args.layers.includes(byId.get(id)!.discipline));
  const floors = new Map(project.building.floors.map((f) => [f.id, f]));
  const target = floors.get(args.targetFloorId);
  const root = byId.get(args.rootId)!;
  const same = root.floorId === args.targetFloorId;
  const copy = copyComponents(project, {
    ids,
    targetFloorId: args.targetFloorId,
    newId: args.newId,
    ...(same ? { offset: { x: 2, y: 2 } } : {}),
    mapFor: (floorId) =>
      floorId === args.targetFloorId ? null : sheetMapping(floors.get(floorId), target),
  });
  const placed = new Map(copy.elements.map((e) => [e.id, e.position]));
  const cables = args.withFeeders
    ? copy.cables.map((c) => {
        const a = placed.get(c.from.elementId);
        const b = placed.get(c.to.elementId);
        // A feeder that ran between two floors (length typed in the Building tab, A-21).
        const between = c.manualLengthM !== undefined;
        if (!between || !a || !b) return c;
        const {
          manualLengthM: _m,
          buildingPath: _p,
          buildingRoute: _r,
          ...rest
        } = c as typeof c & {
          buildingRoute?: unknown;
        };
        return CableSchema.parse({ ...rest, route: [a, b] });
      })
    : [];
  // The copy of the clone's top component first (the one to connect a feeder to).
  const ri = project.model.elements
    .filter((e) => ids.includes(e.id))
    .findIndex((e) => e.id === args.rootId);
  const elements =
    ri < 0 ? copy.elements : [copy.elements[ri]!, ...copy.elements.filter((_, i) => i !== ri)];
  return { elements, cables, skipped: all.length - ids.length };
}
