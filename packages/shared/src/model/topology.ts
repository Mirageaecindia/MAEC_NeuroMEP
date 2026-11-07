import type { Cable } from './cable.js';
import type { Element, ElementKind } from './elements.js';
import type { Riser } from './riser.js';
import type { Port } from './wiring.js';

/**
 * Connections (A-20, user decision 7 Nov 2026): NeuroMEP does not restrict which component feeds
 * which - the electrical engineer decides. The usual connections of Section 3 are guidance only,
 * shown in the Engineering Property of a component (`usualConnections`, `unusualConnections`).
 * The one connection refused is a loop (E1401): Cable Size cannot calculate a circular network.
 */

const MAIN: ElementKind[] = ['lv-panel', 'mdb', 'emdb', 'acb-panel']; // L2
const SUB: ElementKind[] = ['smdb', 'esmdb', 'mcc', 'emcc']; // L4

/**
 * What usually feeds each kind (Section 3 "Allowed Upstream" and the hierarchy table, with
 * the manager's correction of 7 Nov 2026: an LV panel / main board may feed an EMDB). Guidance.
 */
const USUAL_UPSTREAM: Partial<Record<ElementKind, ElementKind[]>> = {
  transformer: ['eb-utility'],
  'lv-panel': ['transformer', 'ats', 'generator'],
  mdb: ['transformer', 'ats', 'generator', 'lv-panel', 'acb-panel'],
  emdb: ['transformer', 'ats', 'generator', 'lv-panel', 'mdb', 'acb-panel'],
  'acb-panel': ['transformer', 'ats', 'generator'],
  ats: ['transformer', ...MAIN, 'generator', 'ups'],
  busbar: [...MAIN, 'transformer'],
  'tap-off-box': ['busbar'],
  smdb: [...MAIN, 'busbar', 'tap-off-box'],
  esmdb: [...MAIN, 'busbar', 'tap-off-box', 'ats'],
  mcc: [...MAIN, 'busbar', 'tap-off-box'],
  emcc: [...MAIN, 'busbar', 'tap-off-box'],
  db: [...SUB, ...MAIN, 'tap-off-box', 'ups'],
  isolator: [...SUB, ...MAIN, 'tap-off-box', 'ups'],
  'connection-unit': [...SUB, ...MAIN, 'tap-off-box', 'ups'],
  motor: ['mcc', 'emcc', 'smdb', 'esmdb'],
  ups: [...MAIN, ...SUB],
  'pfc-bank': [...MAIN],
};

/** Names of the component kinds, as engineers say them. */
export const KIND_LABELS: Record<ElementKind, string> = {
  'eb-utility': 'EB utility / RMU',
  transformer: 'Transformer',
  generator: 'Generator',
  ups: 'UPS',
  ats: 'ATS',
  'lv-panel': 'LV Panel',
  mdb: 'MDB',
  emdb: 'EMDB',
  'acb-panel': 'ACB Panel',
  smdb: 'SMDB',
  esmdb: 'ESMDB',
  mcc: 'MCC',
  emcc: 'EMCC',
  db: 'DB',
  busbar: 'Busbar',
  'tap-off-box': 'Tap-off box',
  isolator: 'Isolator',
  'connection-unit': 'Connection unit',
  motor: 'Motor',
  'pfc-bank': 'PFC bank',
  equipment: 'Equipment',
};

/** Does `from` usually feed `to` (Section 3)? Guidance only - never refuses a connection. */
export const usuallyFeeds = (from: ElementKind, to: ElementKind) =>
  (USUAL_UPSTREAM[to] ?? []).includes(from);

/** The kinds that usually feed `kind`, and that `kind` usually feeds (Engineering Property). */
export function usualConnections(kind: ElementKind): {
  fedFrom: ElementKind[];
  feeds: ElementKind[];
} {
  const feeds = (Object.keys(USUAL_UPSTREAM) as ElementKind[]).filter((k) => usuallyFeeds(kind, k));
  return { fedFrom: USUAL_UPSTREAM[kind] ?? [], feeds };
}

/** Boards with more ways than this get a note (Section 3 suggests at most 18, 25 at the most). */
const WARN_WAYS = 18;

/**
 * Notes on a component's connections that differ from the usual ones (Engineering Property):
 * fed from an unusual component, more than one supply, many ways. Information, never a block.
 */
export function unusualConnections(
  model: { elements: readonly Element[]; cables: readonly Cable[]; risers?: readonly Riser[] },
  element: Element,
): string[] {
  const notes: string[] = [];
  const tag = (id: string) => model.elements.find((e) => e.id === id);
  const incoming = model.cables.filter((c) => c.to.elementId === element.id);
  for (const c of incoming) {
    const from = tag(c.from.elementId);
    if (from && USUAL_UPSTREAM[element.kind] && !usuallyFeeds(from.kind, element.kind)) {
      notes.push(
        `Fed from ${from.tag}: a ${KIND_LABELS[from.kind]} does not usually feed a ${KIND_LABELS[element.kind]}.`,
      );
    }
  }
  const riser = model.risers?.some((r) => r.feeds.includes(element.id)) ?? false;
  const supplies = incoming.filter((c) => c.to.port === 'in').length + (riser ? 1 : 0);
  const limit = MAIN.includes(element.kind) ? 2 : 1;
  if (element.kind !== 'ats' && supplies > limit) {
    notes.push(
      `${supplies} supplies (${riser ? 'riser and feeders' : 'feeders'}): each one is sized for the whole load of ${element.tag}.`,
    );
  }
  const ways = model.cables.filter((c) => c.from.elementId === element.id).length;
  if (ways > WARN_WAYS) notes.push(`${ways} outgoing ways (usually at most ${WARN_WAYS}).`);
  return notes;
}

export type TopologyCheck = { ok: true } | { ok: false; code: 'E1401'; message: string };

/** Every component upstream of an element (following the cables against their direction). */
export function upstreamOf(id: string, cables: readonly Cable[]): Set<string> {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const current = queue.pop()!;
    for (const c of cables) {
      if (c.to.elementId === current && !seen.has(c.from.elementId)) {
        seen.add(c.from.elementId);
        queue.push(c.from.elementId);
      }
    }
  }
  return seen;
}

/**
 * Checks a new feeder from `from` to `to`. Any component may feed any other (A-20); only a loop
 * is refused (E1401), because the supply must flow one way for Cable Size to work it out.
 */
export function topologyCheck(
  model: { cables: readonly Cable[]; risers?: readonly Riser[] },
  from: Element,
  to: Element,
  _toPort?: Port,
): TopologyCheck {
  if (from.id === to.id || upstreamOf(from.id, model.cables).has(to.id)) {
    return {
      ok: false,
      code: 'E1401',
      message: `${to.tag} already feeds ${from.tag}: a feeder back to it would make a loop, which Cable Size cannot calculate.`,
    };
  }
  return { ok: true };
}
