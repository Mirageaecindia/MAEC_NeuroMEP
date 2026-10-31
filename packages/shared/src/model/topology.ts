import type { Cable } from './cable.js';
import type { Element, ElementKind } from './elements.js';
import type { Riser } from './riser.js';
import type { Port } from './wiring.js';

/**
 * Topology rules of Section 3, checked when a cable is connected (#TASK-14, FR-16). A refusal
 * carries E1401 "Connection not allowed"; a warning lets the cable be drawn.
 *
 * Section 3 does not say which source goes on which ATS input: normal is taken from a
 * transformer or main board, standby from a generator or UPS (assumption, to be confirmed).
 */

const MAIN: ElementKind[] = ['lv-panel', 'mdb', 'emdb', 'acb-panel']; // L2
const SUB: ElementKind[] = ['smdb', 'esmdb', 'mcc', 'emcc']; // L4

/** What may feed each kind (Section 3 "Allowed Upstream" and the hierarchy table). */
const ALLOWED_UPSTREAM: Partial<Record<ElementKind, ElementKind[]>> = {
  transformer: ['eb-utility'],
  'lv-panel': ['transformer', 'ats', 'generator'],
  mdb: ['transformer', 'ats', 'generator'],
  emdb: ['transformer', 'ats', 'generator'],
  'acb-panel': ['transformer', 'ats', 'generator'],
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
  ups: [...MAIN],
  'pfc-bank': [...MAIN],
};
/** May an element of kind `from` feed one of kind `to` (Section 3)? */
export const mayFeed = (from: ElementKind, to: ElementKind) =>
  (ALLOWED_UPSTREAM[to] ?? []).includes(from);

const ATS_INPUT: Record<'normal' | 'standby', ElementKind[]> = {
  normal: ['transformer', ...MAIN],
  standby: ['generator', 'ups'],
};

/** Boards with outgoing ways: at most 25, a warning above 18 (Section 3). */
const MAX_WAYS = 25;
const WARN_WAYS = 18;

export type TopologyCheck =
  { ok: true; warning?: string } | { ok: false; code: 'E1401'; message: string };

const refuse = (message: string): TopologyCheck => ({ ok: false, code: 'E1401', message });

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

/** Checks a new cable from `from` to `to` (port `toPort`) against the model (Section 3). */
export function topologyCheck(
  model: { cables: readonly Cable[]; risers?: readonly Riser[] },
  from: Element,
  to: Element,
  toPort: Port,
): TopologyCheck {
  const cables = model.cables;

  // Who may feed whom.
  if (to.kind === 'ats' && (toPort === 'normal' || toPort === 'standby')) {
    if (!ATS_INPUT[toPort].includes(from.kind)) {
      return refuse(`The ${toPort} input of ${to.tag} cannot be fed from ${from.tag}.`);
    }
  } else if (!mayFeed(from.kind, to.kind)) {
    return refuse(`${from.tag} cannot feed ${to.tag}: follow source > MDB > SMDB / MCC > DB.`);
  }

  // One supply per component; up to two incomers on an LV panel / MDB; one per ATS input.
  if (model.risers?.some((r) => r.feeds.includes(to.id))) {
    return refuse(`${to.tag} is already fed from a riser (Building tab).`);
  }
  const incoming = cables.filter((c) => c.to.elementId === to.id);
  if (to.kind === 'ats') {
    if (incoming.some((c) => c.to.port === toPort)) {
      return refuse(`The ${toPort} input of ${to.tag} is already connected.`);
    }
  } else if (incoming.length >= (MAIN.includes(to.kind) ? 2 : 1)) {
    return refuse(
      MAIN.includes(to.kind)
        ? `${to.tag} already has two incomers.`
        : `${to.tag} is already fed from another board.`,
    );
  }

  // Radial network: no loops.
  if (upstreamOf(from.id, cables).has(to.id)) {
    return refuse(`${to.tag} already feeds ${from.tag}: the network must stay radial (no loops).`);
  }

  // Ways on the source board.
  const ways = cables.filter((c) => c.from.elementId === from.id).length + 1;
  if ([...MAIN, ...SUB].includes(from.kind)) {
    if (ways > MAX_WAYS) return refuse(`${from.tag} has ${MAX_WAYS} ways already (maximum).`);
    if (ways > WARN_WAYS) {
      return { ok: true, warning: `${from.tag} now has ${ways} ways (more than ${WARN_WAYS}).` };
    }
  }
  return { ok: true };
}

/**
 * May this feeder be a busbar (decision 1 Nov 2026)? A busbar feeder starts at a transformer or a
 * main panel (Section 3: they may feed a busbar). Returns the reason when not.
 */
export function busbarFeederIssue(from: Element | undefined): string | null {
  if (!from || mayFeed(from.kind, 'busbar')) return null;
  return `A busbar feeder starts at a transformer or a main panel (LV Panel / MDB), not ${from.tag}.`;
}
