import { z } from 'zod';
import type { Project } from '../project/schema.js';
import { stable } from '../stable.js';
import type { Cable } from './cable.js';
import type { Element } from './elements.js';
import { suppliedIn } from './network.js';
import { ElementResultSchema, type CheckCode, type ElementResult } from './results.js';

/**
 * Cable Size runs (FR-18, FR-21, WBS 1.5.1). The last result of each component and feeder is kept
 * in the project with the inputs it used; when those inputs change it is "Out of date" until Cable
 * Size runs again. Until the engine (WBS 1.6) is connected in WBS 1.7.1, `mockRun` gives clearly
 * labelled placeholder results: status and checks only, no values.
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

export const MOCK_ENGINE = 'mock';
export const MOCK_NOTE = 'Mock run - the calculation engine arrives in WBS 1.6';

type Item = Element | Cable;
const isCable = (x: Item): x is Cable => 'route' in x;

/** Electrical components and all feeders: the items Cable Size gives a result. */
function sizedItems(p: Project): Item[] {
  return [...p.model.elements.filter((e) => e.discipline === 'electrical'), ...p.model.cables];
}

export function scopeItems(p: Project, scope: SizingScope): Item[] {
  const items = sizedItems(p);
  if (scope.kind === 'element') return items.filter((x) => x.id === scope.id);
  if (scope.kind === 'floor') return items.filter((x) => x.floorId === scope.floorId);
  return items;
}

/**
 * The inputs a result depends on: the item itself (not its tag, text, position on the plan or
 * version) and the calculation set-up. The engine widens this to the supply path in WBS 1.7.1.
 */
export function inputsKey(p: Project, item: Item): string {
  const {
    version: _v,
    tag: _t,
    ...rest
  } = item as Item & {
    position?: unknown;
    symbolScale?: unknown;
    description?: unknown;
    location?: unknown;
  };
  const {
    position: _p,
    symbolScale: _s,
    description: _d,
    location: _l,
    ...inputs
  } = rest as Record<string, unknown>;
  return stable({ inputs, calculation: p.calculation });
}

/** Checks not ticked on Page 1 are not calculated (D-08); C1 and C2 always are (A-06). */
const OPTIONAL: Partial<Record<CheckCode, keyof Project['calculation']['checks']>> = {
  C3: 'shortCircuit',
  C7: 'shortCircuit',
  C4: 'letThroughEnergy',
  C5: 'earthFaultLoopImpedance',
};

function mockResult(p: Project, item: Item, supplied: Set<string>): ElementResult {
  const id = isCable(item) ? item.to.elementId : item.id;
  const checks = Object.fromEntries(
    (['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] as const).map((c) => {
      const tick = OPTIONAL[c];
      return [
        c,
        tick && !p.calculation.checks[tick]
          ? { state: 'not-calculated', detail: 'Not calculated - not selected on Page 1' }
          : { state: 'not-calculated', detail: MOCK_NOTE },
      ];
    }),
  ) as ElementResult['checks'];
  return {
    elementId: item.id,
    status: 'provisional',
    provisionalReasons: [...(supplied.has(id) ? [] : (['upstream-not-connected'] as const))],
    errors: [],
    sizedBy: null,
    checks,
    size: null,
    device: null,
    load: null,
    values: {
      ibA: null,
      inA: null,
      izA: null,
      vdOwnPct: null,
      vdTotalPct: null,
      ikMaxKa: null,
      ikMinKa: null,
      ipKa: null,
      zsMohm: null,
    },
    trace: [{ step: 'Mock', detail: MOCK_NOTE }],
  };
}

/** Placeholder Cable Size run over a scope; returns the project's new result list. */
export function mockRun(
  p: Project,
  scope: SizingScope,
  run: { runId: string; at: string },
): StoredResult[] {
  const supplied = suppliedIn(p.model, 'normal');
  const fresh = scopeItems(p, scope).map((item): StoredResult => ({
    ...mockResult(p, item, supplied),
    runId: run.runId,
    ranAt: run.at,
    engineVersion: MOCK_ENGINE,
    rulePackVersion: p.rulePackVersion,
    inputsKey: inputsKey(p, item),
  }));
  const ids = new Set(fresh.map((r) => r.elementId));
  // Results of removed items are dropped; the rest are kept from earlier runs.
  const live = new Set(sizedItems(p).map((x) => x.id));
  return [
    ...p.model.results.filter((r) => !ids.has(r.elementId) && live.has(r.elementId)),
    ...fresh,
  ];
}

/** The last result of an item and whether its inputs changed since (FR-21 "Out of date"). */
export function resultOf(
  p: Project,
  id: string,
): { result: StoredResult; outOfDate: boolean } | null {
  const result = p.model.results.find((r) => r.elementId === id);
  const item = sizedItems(p).find((x) => x.id === id);
  if (!result || !item) return null;
  return { result, outOfDate: result.inputsKey !== inputsKey(p, item) };
}

/** Voltage drop to 2 decimals (FR-36). */
export const formatVd = (pct: number | null) => (pct === null ? '-' : `${pct.toFixed(2)} %`);
