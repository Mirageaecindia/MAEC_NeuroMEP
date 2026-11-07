import type { Cable } from './cable.js';
import type { Element, LoadCategory } from './elements.js';
import type { Riser } from './riser.js';

/**
 * Fire-rated feeders (10.14, briefing page 9, 6 Nov 2026). Every feeder from a fire & life-safety
 * load back to the generator must be fire-rated: the feeder into the load, then up through the
 * standby input of an ATS to the generator (manager 3 Nov 2026: FR only on the generator side).
 * The flags are live and never change a cable (user decision 6 Nov 2026): a feeder on that path
 * that is not fire-rated (E2701), and a fire-rated one with no FLS load below it (E2702).
 */

interface Network {
  elements: readonly Element[];
  cables: readonly Cable[];
  risers: readonly Riser[];
}

/**
 * Load category a component counts with: its own, except that an isolator / connection unit
 * feeding FLS equipment counts as FLS (user decision 6 Nov 2026: the equipment's layer cannot
 * change the electrical isolator, so this is worked out, not stored). Equipment: FLS / normal.
 */
export function loadCategoryOf(e: Element, elements: readonly Element[]): LoadCategory | null {
  if (e.kind === 'equipment') return e.fls ? 'fls' : 'normal';
  if (!('loadCategory' in e)) return null;
  const flsBelow = elements.some((x) => x.kind === 'equipment' && x.fedFromId === e.id && x.fls);
  return flsBelow ? 'fls' : e.loadCategory;
}

export const isFireRated = (c: Cable) =>
  c.feederType === 'busbar' ? (c.busbar?.fireRated ?? false) : c.construction.insulation === 'FR';

/** Feeders on the path from each FLS load to the generator, with the FLS loads each one serves. */
export function flsPaths(m: Network): Map<string, string[]> {
  const byId = new Map(m.elements.map((e) => [e.id, e]));
  const onPath = new Map<string, string[]>();
  for (const load of m.elements.filter(
    (e) => e.kind !== 'equipment' && loadCategoryOf(e, m.elements) === 'fls',
  )) {
    const stack = [load.id];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const ats = byId.get(cur)?.kind === 'ats';
      for (const c of m.cables) {
        if (c.to.elementId !== cur || (ats && c.to.port !== 'standby')) continue;
        onPath.set(c.id, [...new Set([...(onPath.get(c.id) ?? []), load.tag])]);
        stack.push(c.from.elementId);
      }
      for (const r of m.risers) if (r.fedFromId && r.feeds.includes(cur)) stack.push(r.fedFromId);
    }
  }
  return onPath;
}

export interface FireRatedFlag {
  cableId: string;
  code: 'E2701' | 'E2702';
  message: string;
  fix: string;
}

export function fireRatedFlags(m: Network): FireRatedFlag[] {
  const paths = flsPaths(m);
  return m.cables.flatMap((c): FireRatedFlag[] => {
    const loads = paths.get(c.id);
    const fr = isFireRated(c);
    if (loads && !fr) {
      return [
        {
          cableId: c.id,
          code: 'E2701',
          message: `${c.tag} feeds fire & life-safety load ${loads.join(', ')} and is not fire-rated`,
          fix:
            c.feederType === 'busbar'
              ? 'Select it and tick Fire Rated in its Engineering Property.'
              : 'Select it and choose FR insulation in its Engineering Property.',
        },
      ];
    }
    if (!loads && fr) {
      return [
        {
          cableId: c.id,
          code: 'E2702',
          message: `${c.tag} is fire-rated but has no fire & life-safety load below it on the generator side`,
          fix: 'Use a normal cable unless it is needed for another reason.',
        },
      ];
    }
    return [];
  });
}

/** Load points that stand for equipment (components sheet: fire rated when their load is FLS). */
const LOAD_POINTS = new Set<Element['kind']>(['isolator', 'connection-unit', 'tap-off-box']);
const FIRE_PUMPS = '9';

/**
 * Defaults applied when a load point is edited (10.14, components sheet; user request 6 Nov 2026):
 * adding a Fire Pumps load makes it FLS, and turning it FLS makes it fire rated. Both stay
 * editable - a value the same edit sets itself wins.
 */
export function withSafetyDefaults(
  e: Element,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  if (!LOAD_POINTS.has(e.kind) || !('loadCategory' in e)) return patch;
  const out = { ...patch };
  const lines = patch.manualLoads;
  if (Array.isArray(lines) && !('loadCategory' in patch) && 'manualLoads' in e) {
    const had = e.manualLoads.some((l) => l.loadType === FIRE_PUMPS);
    const has = (lines as { loadType?: string }[]).some((l) => l.loadType === FIRE_PUMPS);
    if (has && !had) out.loadCategory = 'fls';
  }
  if (out.loadCategory === 'fls' && e.loadCategory !== 'fls' && !('fireRated' in patch)) {
    out.fireRated = true;
  }
  // Leaving FLS unticks Fire rated as well (manager feedback, 7 Nov 2026); it can be ticked again.
  if (
    'loadCategory' in out &&
    out.loadCategory !== 'fls' &&
    e.loadCategory === 'fls' &&
    !('fireRated' in patch)
  ) {
    out.fireRated = false;
  }
  return out;
}
