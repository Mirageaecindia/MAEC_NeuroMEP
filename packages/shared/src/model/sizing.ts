import { z } from 'zod';
import type { Project } from '../project/schema.js';
import { stable } from '../stable.js';
import type { Cable } from './cable.js';
import type { Element } from './elements.js';
import type { Riser } from './riser.js';
import { ElementResultSchema, type ElementResult } from './results.js';

/**
 * Cable Size runs (FR-18, FR-21, WBS 1.5.1 / 1.7.1). The engine (packages/engine) sizes the whole
 * network on every run; the results of the items in the run's scope are kept in the project with
 * a fingerprint of the inputs they used. Sizes depend on the whole network - a load below changes
 * Ib above, a size above changes the voltage drop and fault level below - so any change to the
 * network or the calculation set-up makes every result "Out of date" until Cable Size runs again.
 */

export const StoredResultSchema = ElementResultSchema.extend({
  runId: z.string().min(1),
  ranAt: z.iso.datetime({ offset: true }),
  engineVersion: z.string(),
  rulePackVersion: z.string().nullable(),
  /** Fingerprint of the inputs the result used (`inputsKey`). */
  inputsKey: z.string(),
});
export type StoredResult = z.infer<typeof StoredResultSchema>;

/** What Cable Size runs on (FR-21): the selected item, the current floor or the whole project. */
export type SizingScope =
  { kind: 'element'; id: string } | { kind: 'floor'; floorId: string } | { kind: 'project' };

type Item = Element | Cable | Riser;

/** Electrical components, all feeders and the risers: the items Cable Size gives a result. */
function sizedItems(p: Project): Item[] {
  return [
    ...p.model.elements.filter((e) => e.discipline === 'electrical'),
    ...p.model.cables,
    ...p.model.risers,
  ];
}

/** The items of a run's scope; risers belong to the building, not to a floor. */
export function scopeItems(p: Project, scope: SizingScope): Item[] {
  const items = sizedItems(p);
  if (scope.kind === 'element') return items.filter((x) => x.id === scope.id);
  if (scope.kind === 'floor') {
    return items.filter((x) => 'floorId' in x && x.floorId === scope.floorId);
  }
  return items;
}

/** cyrb53: a short, fast fingerprint (not for security). */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * The inputs every result depends on: the network (components with their loads, feeders with
 * route, construction and locks, risers), the calculation set-up, the site and the rule-pack
 * version - not tags, texts, positions on the plan or versions.
 */
export function inputsKey(p: Project): string {
  const elements = p.model.elements.map((e) => {
    const {
      version: _v,
      tag: _t,
      ...rest
    } = e as Element & {
      position?: unknown;
      rotationDeg?: unknown;
      symbolScale?: unknown;
      description?: unknown;
      location?: unknown;
    };
    const {
      position: _p,
      symbolScale: _s,
      rotationDeg: _r,
      description: _d,
      location: _l,
      ...inputs
    } = rest;
    return inputs;
  });
  // The Building-tab path is drawing only (9 Nov 2026).
  const cables = p.model.cables.map(
    ({ version: _v, tag: _t, buildingRoute: _b, ...inputs }) => inputs,
  );
  return hash(
    stable({
      elements,
      cables,
      risers: p.model.risers,
      calculation: p.calculation,
      site: p.site,
      rulePackVersion: p.rulePackVersion,
    }),
  );
}

/**
 * The project's results after a run: the fresh results of the items in `scope` replace their
 * earlier ones; results of removed items are dropped; the rest are kept from earlier runs.
 */
export function mergeRun(
  p: Project,
  scope: SizingScope,
  fresh: ElementResult[],
  run: { runId: string; at: string; engineVersion: string; inputsKey: string },
): StoredResult[] {
  const inScope = new Set(scopeItems(p, scope).map((x) => x.id));
  const stored = fresh
    .filter((r) => inScope.has(r.elementId))
    .map((r): StoredResult => ({
      ...r,
      runId: run.runId,
      ranAt: run.at,
      engineVersion: run.engineVersion,
      rulePackVersion: p.rulePackVersion,
      inputsKey: run.inputsKey,
    }));
  const ids = new Set(stored.map((r) => r.elementId));
  const live = new Set(sizedItems(p).map((x) => x.id));
  return [
    ...p.model.results.filter((r) => !ids.has(r.elementId) && live.has(r.elementId)),
    ...stored,
  ];
}

/**
 * The last result of an item and whether the inputs changed since (FR-21 "Out of date"). Pass
 * `key` (`inputsKey(p)`) when looking up many items of the same project.
 */
export function resultOf(
  p: Project,
  id: string,
  key: string = inputsKey(p),
): { result: StoredResult; outOfDate: boolean } | null {
  const result = p.model.results.find((r) => r.elementId === id);
  if (!result || !sizedItems(p).some((x) => x.id === id)) return null;
  return { result, outOfDate: result.inputsKey !== key };
}

/** Voltage drop to 2 decimals (FR-36). */
export const formatVd = (pct: number | null) => (pct === null ? '-' : `${pct.toFixed(2)} %`);
