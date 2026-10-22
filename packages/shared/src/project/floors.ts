import type { Floor, FloorType, Project } from './schema.js';

/** Floor counts entered on Page 1 (FR-06). Ground floor is always exactly one. */
export interface FloorCounts {
  basements: number;
  podiums: number;
  typicals: number;
}

export type PlanStatus = 'No plan' | 'Uncalibrated' | 'Calibrated';

export function planStatus(floor: Pick<Floor, 'plan'>): PlanStatus {
  if (!floor.plan) return 'No plan';
  return floor.plan.calibration ? 'Calibrated' : 'Uncalibrated';
}

interface FloorSlot {
  code: string;
  name: string;
  type: FloorType;
}

/** Ordered bottom to top: B{n} ... B1, GF, P1 ... P{n}, 1 ... {n}. */
export function floorSlots(counts: FloorCounts): FloorSlot[] {
  const slots: FloorSlot[] = [];
  for (let b = counts.basements; b >= 1; b--) {
    slots.push({ code: `B${b}`, name: `Basement ${b}`, type: 'basement' });
  }
  slots.push({ code: 'GF', name: 'Ground Floor', type: 'ground' });
  for (let p = 1; p <= counts.podiums; p++) {
    slots.push({ code: `P${p}`, name: `Podium ${p}`, type: 'podium' });
  }
  for (let t = 1; t <= counts.typicals; t++) {
    slots.push({ code: String(t), name: `Typical Floor ${t}`, type: 'typical' });
  }
  return slots;
}

export interface RegistryChange {
  floors: Floor[];
  /** Existing floors that are not in the new registry. */
  removed: Floor[];
  /** Removed floors that have a plan - the user must confirm before these are dropped. */
  removedWithPlans: Floor[];
}

/**
 * Builds the floor registry from the counts. Floors that already exist (same code) keep their id,
 * name, height and plan, so regenerating never loses work silently.
 */
export function generateRegistry(
  counts: FloorCounts,
  existing: readonly Floor[],
  newId: () => string,
): RegistryChange {
  for (const [k, v] of Object.entries(counts)) {
    if (!Number.isInteger(v) || v < 0)
      throw new Error(`Floor count "${k}" must be a whole number >= 0`);
  }
  const byCode = new Map(existing.map((f) => [f.code, f]));
  const floors = floorSlots(counts).map(
    (slot): Floor => byCode.get(slot.code) ?? { id: newId(), ...slot, heightM: null, plan: null },
  );
  const kept = new Set(floors.map((f) => f.id));
  const removed = existing.filter((f) => !kept.has(f.id));
  return { floors, removed, removedWithPlans: removed.filter((f) => f.plan !== null) };
}

/**
 * Finished floor levels (m) from the GF datum and the floor-to-floor heights. A floor's height is
 * the distance up to the next floor, so levels above GF add the heights of the floors below them
 * and basement levels subtract their own heights. Returns null where a needed height is missing.
 */
export function computeLevels(
  floors: readonly Floor[],
  gfLevelM: number,
): Map<string, number | null> {
  const levels = new Map<string, number | null>();
  const g = floors.findIndex((f) => f.type === 'ground');
  if (g < 0) {
    for (const f of floors) levels.set(f.id, null);
    return levels;
  }
  const round = (x: number) => Math.round(x * 1000) / 1000;
  levels.set(floors[g]!.id, round(gfLevelM));
  for (let i = g + 1; i < floors.length; i++) {
    const below = levels.get(floors[i - 1]!.id) ?? null;
    const h = floors[i - 1]!.heightM;
    levels.set(floors[i]!.id, below === null || h === null ? null : round(below + h));
  }
  for (let i = g - 1; i >= 0; i--) {
    const above = levels.get(floors[i + 1]!.id) ?? null;
    const h = floors[i]!.heightM;
    levels.set(floors[i]!.id, above === null || h === null ? null : round(above - h));
  }
  return levels;
}

/** Applies a registry change: new floor list, and mechanical-floor references to removed floors cleared. */
export function applyRegistryChange(
  building: Project['building'],
  counts: FloorCounts,
  change: RegistryChange,
): Project['building'] {
  const ids = new Set(change.floors.map((f) => f.id));
  const mech = building.mechanicalFloorIds.map((id) => (id !== null && ids.has(id) ? id : null));
  return {
    ...building,
    counts: { ...counts },
    floors: change.floors,
    mechanicalFloorIds: mech as Project['building']['mechanicalFloorIds'],
  };
}

/** Tags shown on registry rows, e.g. "MF1" for mechanical floor 1. */
export function floorTags(
  building: Pick<Project['building'], 'mechanicalFloorIds'>,
): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  building.mechanicalFloorIds.forEach((id, i) => {
    if (id !== null) tags.set(id, [...(tags.get(id) ?? []), `MF${i + 1}`]);
  });
  return tags;
}
