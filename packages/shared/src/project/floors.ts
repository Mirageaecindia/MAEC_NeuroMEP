import type { Floor, FloorType, Project } from './schema.js';

/**
 * Floor counts entered on Import File (FR-06, 12.1; user request 7 Nov 2026): No of Basements,
 * GF (ground levels, default 1), No of Podium levels and No of Typical floors. Mechanical floors
 * (as many as wanted) are chosen from the upper floors (`mechanicalFloorIds`), not extra floors.
 */
export interface FloorCounts {
  basements: number;
  /** Ground levels: 1 = "Ground Floor"; 2 or more = "Ground Floor 1", "Ground Floor 2" ... */
  grounds?: number;
  podiums: number;
  typicals: number;
}

export type PlanStatus = 'No plan' | 'Uncalibrated' | 'Calibrated';

export function planStatus(floor: Pick<Floor, 'plan'>): PlanStatus {
  if (!floor.plan) return 'No plan';
  return floor.plan.calibration ? 'Calibrated' : 'Uncalibrated';
}

const ORDINALS = [
  'First',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Eighth',
  'Ninth',
  'Tenth',
  'Eleventh',
  'Twelfth',
  'Thirteenth',
  'Fourteenth',
  'Fifteenth',
  'Sixteenth',
  'Seventeenth',
  'Eighteenth',
  'Nineteenth',
  'Twentieth',
];

/** "First Floor", "Second Floor" ... as in the Building tab (Figma); "Floor 21" beyond twenty. */
export const upperFloorName = (n: number) =>
  n >= 1 && n <= ORDINALS.length ? `${ORDINALS[n - 1]} Floor` : `Floor ${n}`;

interface FloorSlot {
  code: string;
  name: string;
  type: FloorType;
}

/** Ordered bottom to top: B{n} ... B1, GF, GF2 ..., P1 ... P{n}, 1 ... {n}. */
export function floorSlots(counts: FloorCounts): FloorSlot[] {
  const slots: FloorSlot[] = [];
  for (let b = counts.basements; b >= 1; b--) {
    slots.push({ code: `B${b}`, name: `Basement ${b}`, type: 'basement' });
  }
  const grounds = Math.max(1, counts.grounds ?? 1);
  for (let g = 1; g <= grounds; g++) {
    slots.push({
      code: g === 1 ? 'GF' : `GF${g}`,
      name: grounds === 1 ? 'Ground Floor' : `Ground Floor ${g}`,
      type: 'ground',
    });
  }
  for (let p = 1; p <= counts.podiums; p++) {
    slots.push({ code: `P${p}`, name: `Podium ${p}`, type: 'podium' });
  }
  for (let t = 1; t <= counts.typicals; t++) {
    slots.push({ code: String(t), name: upperFloorName(t), type: 'typical' });
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
    counts: { ...counts, grounds: counts.grounds ?? 1 },
    floors: change.floors,
    mechanicalFloorIds: mech,
  };
}

/**
 * The typical floors that share one plan (user request 7 Nov 2026): every floor of type
 * 'typical' that is not chosen as a mechanical floor. Mechanical floors keep their own plan.
 */
export function typicalSet(
  building: Pick<Project['building'], 'floors' | 'mechanicalFloorIds'>,
): Floor[] {
  const mech = new Set(building.mechanicalFloorIds.filter((id): id is string => id !== null));
  return building.floors.filter((f) => f.type === 'typical' && !mech.has(f.id));
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
