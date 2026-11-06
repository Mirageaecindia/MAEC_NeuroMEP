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

/**
 * LV components below the sources (those that need a supply). Equipment is checked on its own:
 * linked to an isolator / connection unit (E1803), which carries the supply check.
 */
const needsSupply = (m: Pick<Network, 'elements'>) =>
  m.elements.filter((e) => !UPSTREAM.includes(e.kind) && e.kind !== 'equipment');

/** What equipment may be fed from (6 Nov 2026). */
export const EQUIPMENT_FEEDERS: ElementKind[] = ['isolator', 'connection-unit'];

/** E1803: mechanical / PHE equipment not linked to an isolator or connection unit. */
export function unlinkedEquipment(m: Pick<Network, 'elements'>): Element[] {
  const byId = new Map(m.elements.map((e) => [e.id, e]));
  return m.elements.filter((e) => {
    if (e.kind !== 'equipment') return false;
    const feeder = e.fedFromId ? byId.get(e.fedFromId) : undefined;
    return !feeder || !EQUIPMENT_FEEDERS.includes(feeder.kind);
  });
}

export interface NetworkIssue {
  code: 'E1801' | 'E1802' | 'E1803';
  floorId: string;
  elementId?: string;
  message: string;
}

/**
 * E1801: a component with no path to a transformer or generator (results stay Provisional).
 * E1802: a floor with boards not fed by a cable, none of them fed from a riser tap-off.
 * E1803: mechanical / PHE equipment not connected to a panel (briefing page 9).
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
  for (const e of unlinkedEquipment(m)) {
    issues.push({
      code: 'E1803',
      floorId: e.floorId,
      elementId: e.id,
      message: `${e.tag} is not connected to a panel: choose its isolator or connection unit in Fed from.`,
    });
  }
  return issues;
}

/** Where a supply path breaks (E1801), with what it cuts off and how to fix it. */
export interface SupplyBreak {
  /** The component without an incoming feeder, or the riser without a source. */
  at: { kind: 'element'; id: string; tag: string } | { kind: 'riser'; index: number };
  message: string;
  fix: string;
  /** Components below the break that have no supply because of it. */
  cutOff: string[];
}

const MAIN_PANELS: ElementKind[] = ['lv-panel', 'mdb', 'emdb', 'acb-panel', 'ats'];

/**
 * E1801 grouped by cause (Building tab): for every component without a path to a source, walk up
 * its feeders and risers to where the chain stops - a component nothing feeds, or a riser with no
 * source - and report that point once with everything it cuts off.
 */
export function supplyBreaks(m: Network): SupplyBreak[] {
  const supplied = new Set([...suppliedIn(m, 'normal'), ...suppliedIn(m, 'standby')]);
  const byId = new Map(m.elements.map((e) => [e.id, e]));
  /** The break above an unsupplied component (first incoming path; all of them are dead). */
  const breakOf = (id: string): SupplyBreak['at'] => {
    const seen = new Set<string>();
    let current = id;
    for (;;) {
      seen.add(current);
      const cable = m.cables.find((c) => c.to.elementId === current);
      const riser = m.risers.findIndex((r) => r.feeds.includes(current));
      const next = cable
        ? cable.from.elementId
        : riser >= 0
          ? m.risers[riser]!.fedFromId
          : undefined;
      if (riser >= 0 && !cable && !next) return { kind: 'riser', index: riser + 1 };
      if (!next || seen.has(next) || !byId.has(next)) {
        return { kind: 'element', id: current, tag: byId.get(current)!.tag };
      }
      current = next;
    }
  };
  const breaks = new Map<string, SupplyBreak>();
  for (const e of needsSupply(m)) {
    if (supplied.has(e.id)) continue;
    const at = breakOf(e.id);
    const key = at.kind === 'riser' ? `riser-${at.index}` : at.id;
    let b = breaks.get(key);
    if (!b) {
      const main = at.kind === 'element' && MAIN_PANELS.includes(byId.get(at.id)!.kind);
      b =
        at.kind === 'riser'
          ? {
              at,
              message: `Riser ${at.index} has no source`,
              fix: `Click Riser ${at.index} in the diagram to choose the transformer, LV panel or MDB that feeds it.`,
              cutOff: [],
            }
          : {
              at,
              message: `${at.tag} has no incoming feeder`,
              fix: main
                ? `In Floor Setup, draw a feeder to ${at.tag} from the transformer (or from the generator through an ATS).`
                : `In Floor Setup, draw a feeder to ${at.tag} from a panel above it, or click it in this diagram to put it on a riser tap-off.`,
              cutOff: [],
            };
      breaks.set(key, b);
    }
    if (at.kind === 'riser' || at.id !== e.id) b.cutOff.push(e.tag);
  }
  return [...breaks.values()];
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
