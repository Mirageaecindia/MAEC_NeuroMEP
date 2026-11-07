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

/** Rows of the Riser Design table (Figma 3.5 - 3.8). */
export const RISER_ROWS = 3;

/** The Riser Design rows: the stored risers, padded with empty ones up to RISER_ROWS. */
export function riserRows(risers: readonly Riser[]): Riser[] {
  const rows = [...risers];
  for (let i = rows.length; i < RISER_ROWS; i++) {
    rows.push({ id: `riser-${i + 1}`, lengthM: null, widthM: null, fedFromId: null, feeds: [] });
  }
  return rows;
}

interface Network {
  elements: readonly Element[];
  cables: readonly Cable[];
  risers: readonly Riser[];
}

/** Not on a riser: equipment (linked through "Fed from") and the supplies above the panels. */
const OFF_RISER = new Set(['equipment', 'eb-utility', 'rmu']);

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

/** Changes the fields of one riser row. */
export function setRiser(
  risers: readonly Riser[],
  id: string,
  patch: Partial<Pick<Riser, 'lengthM' | 'widthM' | 'fedFromId'>>,
): Riser[] {
  return riserRows(risers).map((r) => (r.id === id ? { ...r, ...patch } : r));
}

/** Feeds a board from a riser (null = from none); a board is on one riser only. */
export function setBoardRiser(
  risers: readonly Riser[],
  boardId: string,
  riserId: string | null,
): Riser[] {
  return riserRows(risers).map((r) => {
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
