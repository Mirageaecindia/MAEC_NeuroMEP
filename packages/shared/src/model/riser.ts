import { z } from 'zod';
import type { Cable } from './cable.js';
import type { Element } from './elements.js';
import { mayFeed, upstreamOf } from './topology.js';

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

/** Components that may feed a riser: transformers and LV panels / MDBs (Section 3). */
export const riserSources = (m: Pick<Network, 'elements'>) =>
  m.elements.filter((e) => mayFeed(e.kind, 'busbar'));

/** Boards of a floor that a riser tap-off may feed: those not fed by a cable. */
export function riserBoards(m: Network, floorId: string): Element[] {
  const cableFed = new Set(m.cables.map((c) => c.to.elementId));
  return m.elements.filter(
    (e) => e.floorId === floorId && mayFeed('tap-off-box', e.kind) && !cableFed.has(e.id),
  );
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
 * A-07: the transformer is connected to the risers - a riser is fed from a transformer, or from a
 * board that cables connect back to a transformer.
 */
export function sourceConnected(m: Network): boolean {
  const kind = new Map(m.elements.map((e) => [e.id, e.kind]));
  return m.risers.some((r) => {
    if (!r.fedFromId) return false;
    const chain = [r.fedFromId, ...upstreamOf(r.fedFromId, m.cables)];
    return chain.some((id) => kind.get(id) === 'transformer');
  });
}
