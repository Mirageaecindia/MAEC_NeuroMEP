import { PROJECT_SCHEMA_VERSION } from './schema.js';

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
  return p.schemaVersion === PROJECT_SCHEMA_VERSION ? p : data;
}
