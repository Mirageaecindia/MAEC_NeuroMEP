import { PROJECT_SCHEMA_VERSION } from './schema.js';

type Rec = Record<string, unknown>;

/**
 * Busbars are drawn as Feeders since 1 Nov 2026: busbar components placed before are removed with
 * their cables (prototype data; decision 1 Nov 2026).
 */
function dropBusbarComponents(model: unknown) {
  if (typeof model !== 'object' || model === null) return;
  const m = model as { elements?: Rec[]; cables?: Rec[] };
  if (!Array.isArray(m.elements)) return;
  const gone = new Set(m.elements.filter((e) => e.kind === 'busbar').map((e) => e.id));
  if (gone.size === 0) return;
  m.elements = m.elements.filter((e) => !gone.has(e.id));
  const end = (c: Rec, k: 'from' | 'to') => (c[k] as Rec | undefined)?.elementId;
  if (Array.isArray(m.cables)) {
    m.cables = m.cables.filter((c) => !gone.has(end(c, 'from')) && !gone.has(end(c, 'to')));
  }
}

/**
 * Upgrades stored project data to the current schemaVersion before validation.
 * v1 -> v2 (design doc v0.3 baseline): system voltage / frequency added, ampacity always on,
 * working directory restored, network model added, pages renumbered 1-4 (D-20).
 */
export function migrateProjectData(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const p = structuredClone(data) as Record<string, unknown> & { schemaVersion?: unknown };
  if (p.schemaVersion === 1) {
    const untouched = { value: null, source: 'rulepack' };
    const calc = (p.calculation ?? {}) as Record<string, unknown>;
    calc.system ??= { voltageLineV: untouched, voltagePhaseV: untouched, frequencyHz: untouched };
    calc.checks = { ...(calc.checks as object), currentCarryingCapacity: true };
    p.calculation = calc;
    p.workingDirectory ??= '';
    p.model ??= { elements: [], cables: [], risers: [], floorFlags: [] };
    const meta = (p.meta ?? {}) as Record<string, unknown>;
    if (meta.lastPage === 'floor-modelling' || meta.lastPage === 'building-modelling') {
      meta.lastPage = 'modelling';
    }
    p.schemaVersion = 2;
  }
  dropBusbarComponents(p.model);
  return p.schemaVersion === PROJECT_SCHEMA_VERSION ? p : data;
}
