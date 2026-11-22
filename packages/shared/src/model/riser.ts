import { z } from 'zod';
import type { Cable } from './cable.js';
import type { Element } from './elements.js';
import { upstreamOf, usuallyFeeds } from './topology.js';

/**
 * A riser of the Building tab (FR-20, A-05): drawn on the left of the Building view; length and
 * width typed in metres (no floor heights). It is fed from a transformer or LV panel / MDB and
 * feeds one board per tap-off (Section 3, L3 riser: busbar + tap-off box > SMDB / MCC / DB).
 * Part of the electrical network model.
 */
export const RiserSchema = z.object({
  id: z.string().min(1),
  lengthM: z.number().positive().nullable(),
  widthM: z.number().positive().nullable(),
  /** The transformer or main board feeding the riser. */
  fedFromId: z.string().min(1).nullable().default(null),
  /** Boards fed from a tap-off of this riser; a board has one supply only. */
  feeds: z.array(z.string().min(1)).default([]),
});
export type Riser = z.infer<typeof RiserSchema>;

/**
 * The Busbar Riser Design rows: the stored risers as they are (22 Nov 2026: risers are added with
 * "Add busbar riser" and deleted from their properties; the three fixed rows are gone).
 */
export function riserRows(risers: readonly Riser[]): Riser[] {
  return [...risers];
}

/** A new, empty busbar riser after the others (its id is never one used before in the list). */
export function addRiser(risers: readonly Riser[]): Riser[] {
  const used = risers.map((r) => Number(/^riser-(\d+)$/.exec(r.id)?.[1] ?? 0));
  const n = Math.max(0, ...used) + 1;
  return [...risers, { id: `riser-${n}`, lengthM: null, widthM: null, fedFromId: null, feeds: [] }];
}

/** Deletes a busbar riser: its source and the boards on its tap-offs are left unfed. */
export const removeRiser = (risers: readonly Riser[], id: string): Riser[] =>
  risers.filter((r) => r.id !== id);

/** A riser that connects something: a source or boards on its tap-offs. */
export const riserConnected = (r: Riser) => r.fedFromId !== null || r.feeds.length > 0;

/** A riser in use: typed length, a source or boards on its tap-offs. */
export const riserInUse = (r: Riser) => r.lengthM !== null || riserConnected(r);

/**
 * How power goes between floors (Building tab radio, user request 22 Nov 2026): through busbar
 * risers, or by feeders only. Stored once chosen; before that, busbar risers when one is in use.
 */
export type Distribution = 'busbar-riser' | 'feeder';
export function distributionOf(m: {
  risers: readonly Riser[];
  distribution?: Distribution | undefined;
}): Distribution {
  return m.distribution ?? (m.risers.some(riserInUse) ? 'busbar-riser' : 'feeder');
}

interface Network {
  elements: readonly Element[];
  cables: readonly Cable[];
  risers: readonly Riser[];
}

/** Not on a riser: equipment and meters (linked, not fed) and the supplies above the panels. */
const OFF_RISER = new Set(['equipment', 'meter', 'eb-utility', 'rmu']);

/**
 * Components that may feed a riser: any electrical component (A-20); transformers and main
 * panels are the usual ones.
 */
export const riserSources = (m: Pick<Network, 'elements'>) => {
  const all = m.elements.filter((e) => e.discipline === 'electrical' && !OFF_RISER.has(e.kind));
  // The usual sources (transformers, main panels) first.
  return [
    ...all.filter((e) => usuallyFeeds(e.kind, 'busbar')),
    ...all.filter((e) => !usuallyFeeds(e.kind, 'busbar')),
  ];
};

/**
 * Components of a floor shown in the Building tab: every component placed on its plan (user
 * request 8 Nov 2026), mechanical / PHE equipment included (shown, not connected there).
 */
export function riserBoards(m: Pick<Network, 'elements'>, floorId: string): Element[] {
  return m.elements.filter((e) => e.floorId === floorId);
}

/** The riser feeding a board, if any. */
export const riserOf = (risers: readonly Riser[], boardId: string) =>
  risers.find((r) => r.feeds.includes(boardId));

/** The risers, with `id` added (empty) when it is not there yet. */
function withRiser(risers: readonly Riser[], id: string | null): Riser[] {
  if (!id || risers.some((r) => r.id === id)) return [...risers];
  return [...risers, { id, lengthM: null, widthM: null, fedFromId: null, feeds: [] }];
}

/** Changes the fields of one riser (added when it is not there yet). */
export function setRiser(
  risers: readonly Riser[],
  id: string,
  patch: Partial<Pick<Riser, 'lengthM' | 'widthM' | 'fedFromId'>>,
): Riser[] {
  return withRiser(risers, id).map((r) => (r.id === id ? { ...r, ...patch } : r));
}

/** Feeds a board from a riser (null = from none); a board is on one riser only. */
export function setBoardRiser(
  risers: readonly Riser[],
  boardId: string,
  riserId: string | null,
): Riser[] {
  return withRiser(risers, riserId).map((r) => {
    const feeds = r.feeds.filter((id) => id !== boardId);
    return { ...r, feeds: r.id === riserId ? [...feeds, boardId] : feeds };
  });
}

/** Drops removed components from the risers (as source or fed board). */
export function withoutElements(risers: readonly Riser[], ids: ReadonlySet<string>): Riser[] {
  return risers.map((r) => ({
    ...r,
    fedFromId: r.fedFromId && ids.has(r.fedFromId) ? null : r.fedFromId,
    feeds: r.feeds.filter((id) => !ids.has(id)),
  }));
}

/**
 * A-07 as amended by A-22 (8 Nov 2026): Cable Size is enabled once a transformer supplies
 * something - by a feeder (on a plan, or between floors in the Building tab) or through a busbar
 * riser fed from it or from a board fed from it. Busbar risers are optional.
 */
export function sourceConnected(m: Network): boolean {
  const kind = new Map(m.elements.map((e) => [e.id, e.kind]));
  if (m.cables.some((c) => kind.get(c.from.elementId) === 'transformer')) return true;
  return m.risers.some((r) => {
    if (!r.fedFromId) return false;
    const chain = [r.fedFromId, ...upstreamOf(r.fedFromId, m.cables)];
    return chain.some((id) => kind.get(id) === 'transformer');
  });
}
