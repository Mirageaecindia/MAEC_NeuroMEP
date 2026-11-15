import type { Element, Project } from '@neuromep/shared';

/**
 * Building tab view filters (user request 15 Nov 2026). View only: nothing is stored in the
 * project and nothing changes in the calculation. A greyed component stays drawn and clickable.
 *
 * Per floor (menu beside the floor name):
 * - all: every component as it is;
 * - power-required: components with no incoming connection are shown, the others greyed - a
 *   transformer (which needs none) is shown too;
 * - disconnected: components with no incoming and no outgoing connection are shown, the
 *   others greyed.
 * Per component (menu when hovering on it): Hide greys it, Hide Reverse greys everything else,
 * Show brings a greyed one back. These win over the floor filter until the floor's filter is
 * chosen again.
 */
export type FloorFilter = 'all' | 'power-required' | 'disconnected';
export type ViewOverride = 'hidden' | 'shown';

export const FILTER_LABEL: Record<FloorFilter, string> = {
  all: 'All components',
  'power-required': 'Power required',
  disconnected: 'Disconnected',
};

export interface Connections {
  /** Has an incoming connection: a feeder to it, a riser tap-off, or (equipment) its isolator. */
  incoming: Set<string>;
  /** Has an outgoing connection: a feeder from it, a riser it feeds, equipment linked to it. */
  outgoing: Set<string>;
}

/** Who is connected to what: feeders, risers and the equipment / meter links. */
export function connections(model: Pick<Project['model'], 'elements' | 'cables' | 'risers'>) {
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  for (const c of model.cables) {
    outgoing.add(c.from.elementId);
    incoming.add(c.to.elementId);
  }
  for (const r of model.risers) {
    if (r.fedFromId) outgoing.add(r.fedFromId);
    for (const id of r.feeds) incoming.add(id);
  }
  for (const e of model.elements) {
    // Equipment takes its supply from the isolator it is linked to (A-17).
    if (e.kind === 'equipment' && e.fedFromId) {
      incoming.add(e.id);
      outgoing.add(e.fedFromId);
    }
    // A meter linked to what it measures is connected (it carries no supply, A-24).
    if (e.kind === 'meter' && e.meteredId) outgoing.add(e.id);
  }
  return { incoming, outgoing } satisfies Connections;
}

/** Whether a floor's filter keeps the component shown. */
export function passesFilter(id: string, filter: FloorFilter, c: Connections): boolean {
  if (filter === 'power-required') return !c.incoming.has(id);
  if (filter === 'disconnected') return !c.incoming.has(id) && !c.outgoing.has(id);
  return true;
}

/** Greyed in the Building tab: its own Hide / Show first, else its floor's filter. */
export function isGreyed(
  e: Element,
  filter: FloorFilter,
  override: ViewOverride | undefined,
  c: Connections,
): boolean {
  if (override) return override === 'hidden';
  return !passesFilter(e.id, filter, c);
}

/**
 * Space between components on a floor line, so that no two tags overlap (user request 15 Nov
 * 2026): the longest tag at about 6 px a character (9 px labels) plus a margin.
 */
export function boardGap(tags: readonly string[]): number {
  const longest = Math.max(0, ...tags.map((t) => t.length));
  return Math.max(96, Math.ceil(longest * 6 + 24));
}
