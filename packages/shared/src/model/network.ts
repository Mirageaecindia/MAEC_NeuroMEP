import type { Floor } from '../project/schema.js';
import type { Cable } from './cable.js';
import type { Element, ElementKind } from './elements.js';
import { riserBoards, type Riser } from './riser.js';

/**
 * Network completeness (FR-20, #TASK-18, WBS 1.4.3) and the normal / standby scenarios (10.14):
 * which components have a supply path to a source through cables, ATS inputs and risers.
 * Which loads must be on standby is open (OI-11); the engine checks the safety rules (C8).
 */

export type Scenario = 'normal' | 'standby';

interface Network {
  elements: readonly Element[];
  cables: readonly Cable[];
  risers: readonly Riser[];
}

/** Normal: the transformer; standby (power failure): the generator, through the ATS standby input. */
const SOURCES: Record<Scenario, ElementKind[]> = {
  normal: ['transformer'],
  standby: ['generator'],
};

/** The utility side above the transformers is not part of the LV network checked here. */
const UPSTREAM: ElementKind[] = ['eb-utility', 'transformer', 'generator'];

/** Components with a supply path to a source of the scenario. */
export function suppliedIn(m: Network, scenario: Scenario): Set<string> {
  const feeders = new Map<string, string[]>();
  const add = (to: string, from: string) => feeders.set(to, [...(feeders.get(to) ?? []), from]);
  for (const c of m.cables) {
    // An ATS takes the input of the scenario only.
    const port = c.to.port;
    if ((port === 'normal' || port === 'standby') && port !== scenario) continue;
    add(c.to.elementId, c.from.elementId);
  }
  for (const r of m.risers) {
    if (r.fedFromId) for (const id of r.feeds) add(id, r.fedFromId);
  }
  const kind = new Map(m.elements.map((e) => [e.id, e.kind]));
  const known = new Map<string, boolean>();
  const supplied = (id: string, path: Set<string>): boolean => {
    if (known.has(id)) return known.get(id)!;
    if (path.has(id)) return false; // loops are refused on connect (E1401); stay safe anyway
    path.add(id);
    const k = kind.get(id);
    const ok =
      (k !== undefined && SOURCES[scenario].includes(k)) ||
      (feeders.get(id) ?? []).some((f) => supplied(f, path));
    known.set(id, ok);
    return ok;
  };
  return new Set(m.elements.filter((e) => supplied(e.id, new Set())).map((e) => e.id));
}

/** LV components below the sources (those that need a supply). */
const needsSupply = (m: Pick<Network, 'elements'>) =>
  m.elements.filter((e) => !UPSTREAM.includes(e.kind));

export interface NetworkIssue {
  code: 'E1801' | 'E1802';
  floorId: string;
  elementId?: string;
  message: string;
}

/**
 * E1801: a component with no path to a transformer or generator (results stay Provisional).
 * E1802: a floor with boards not fed by a cable, none of them fed from a riser tap-off.
 */
export function completenessIssues(m: Network, floors: readonly Floor[]): NetworkIssue[] {
  const normal = suppliedIn(m, 'normal');
  const standby = suppliedIn(m, 'standby');
  const issues: NetworkIssue[] = [];
  for (const f of floors) {
    const boards = riserBoards(m, f.id);
    if (boards.length > 0 && !boards.some((b) => m.risers.some((r) => r.feeds.includes(b.id)))) {
      issues.push({
        code: 'E1802',
        floorId: f.id,
        message: `${f.name} has boards but no tap-off from a riser.`,
      });
    }
  }
  for (const e of needsSupply(m)) {
    if (normal.has(e.id) || standby.has(e.id)) continue;
    issues.push({
      code: 'E1801',
      floorId: e.floorId,
      elementId: e.id,
      message: `${e.tag} has no path to a transformer or generator.`,
    });
  }
  return issues;
}

/** Components supplied and not supplied in a scenario (the Building tab scenario switch). */
export function scenarioSupply(m: Network, scenario: Scenario) {
  const on = suppliedIn(m, scenario);
  const all = needsSupply(m);
  return {
    supplied: all.filter((e) => on.has(e.id)),
    notSupplied: all.filter((e) => !on.has(e.id)),
  };
}
