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
 * to an isolator outside the copy loses the link (E1803 until linked again).
 */
export interface CopyResult {
  elements: Element[];
  cables: Cable[];
}

const shift = (p: ModelPoint, d: ModelPoint): ModelPoint => ({ x: p.x + d.x, y: p.y + d.y });

/** Copies of `ids` on `targetFloorId`, moved by `offset` metres. */
export function copyComponents(
  project: Pick<Project, 'building' | 'model'>,
  args: {
    ids: readonly string[];
    targetFloorId: string;
    offset?: ModelPoint;
    newId: () => string;
  },
): CopyResult {
  const { elements, cables } = project.model;
  const floor = project.building.floors.find((f) => f.id === args.targetFloorId);
  if (!floor) throw new Error(`No floor ${args.targetFloorId}`);
  const offset = args.offset ?? { x: 0, y: 0 };
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
      'fedFromId' in e ? { fedFromId: (e.fedFromId && idOf.get(e.fedFromId)) ?? null } : {};
    return ElementSchema.parse({
      ...e,
      ...linked,
      id: idOf.get(e.id)!,
      version: 0,
      tag,
      floorId: floor.id,
      position: shift(e.position, offset),
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
      route: c.route.map((p) => shift(p, offset)),
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
