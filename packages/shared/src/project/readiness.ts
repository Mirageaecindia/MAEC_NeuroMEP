import { DEMAND_CATEGORY_LABELS, LOAD_TYPE_LABELS, type Region } from './enums.js';
import { planStatus } from './floors.js';
import type { DefaultableNumber, Project } from './schema.js';

/** Validation ranges for Page 1 inputs (design doc 12.1). */
export const PAGE1_LIMITS = {
  ambientAirC: { min: 0, max: 60 },
  ambientSoilC: { min: 0, max: 50 },
  soilResistivity: { min: 0.5, max: 3.0 },
  altitudeM: { min: 0, max: 5000 },
  floorHeightM: { min: 2.5, max: 10 },
  demandFactor: { min: 0, max: 1 },
} as const;

/** Page 1 cards, numbered as on screen. */
export type Page1Card = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Page1Issue {
  /** Stable field id; the UI uses it as the element id to scroll to. */
  field: string;
  card: Page1Card;
  message: string;
}

const blank = (s: string) => s.trim() === '';
const inRange = (v: number, r: { min: number; max: number }) => v >= r.min && v <= r.max;

/**
 * Everything that must be fixed before Page 1 can be left with Next (FR-03 to FR-08, Section 9 exit
 * condition). Issues are listed in screen order so the first one is the first on the page.
 * Demand factors may stay empty ("TBC", OI-01); a value that is entered must be 0-1.
 */
export function page1Issues(
  project: Project,
  ctx: { activeRegions: readonly Region[] },
): Page1Issue[] {
  const issues: Page1Issue[] = [];
  const add = (card: Page1Card, field: string, message: string) =>
    issues.push({ card, field, message });

  // Card 1 - Project details
  const d = project.details;
  if (blank(d.name)) add(1, 'details.name', 'Enter the project name.');
  if (blank(d.location)) add(1, 'details.location', 'Enter the location.');
  if (blank(d.clientName)) add(1, 'details.clientName', 'Enter the client name.');
  if (blank(d.plotRef)) add(1, 'details.plotRef', 'Enter the plot reference.');
  if (!d.designStage) add(1, 'details.designStage', 'Choose the design stage.');
  if (blank(d.revision)) add(1, 'details.revision', 'Enter the revision.');
  if (!d.category) add(1, 'details.category', 'Choose the project category.');
  if (d.plotLoad.value === null) add(1, 'details.plotLoad', 'Enter the plot load allocation.');
  else if (!(d.plotLoad.value > 0)) add(1, 'details.plotLoad', 'Plot load must be greater than 0.');

  // Card 2 - Site conditions
  const site: [keyof typeof PAGE1_LIMITS & keyof Project['site'], string, string][] = [
    ['ambientAirC', 'ambient air temperature', '°C'],
    ['ambientSoilC', 'ambient soil temperature', '°C'],
    ['soilResistivity', 'soil thermal resistivity', '°C·m/W'],
  ];
  for (const [key, label, unit] of site) {
    const v = (project.site[key] as DefaultableNumber).value;
    const r = PAGE1_LIMITS[key];
    if (v === null) add(2, `site.${key}`, `Enter the ${label}.`);
    else if (!inRange(v, r))
      add(2, `site.${key}`, `Must be between ${r.min} and ${r.max} ${unit}.`);
  }
  const alt = project.site.altitudeM;
  if (alt !== null && !inRange(alt, PAGE1_LIMITS.altitudeM)) {
    add(2, 'site.altitudeM', 'Altitude must be between 0 and 5000 m (or left empty).');
  }

  // Card 3 - Calculation set-up
  const c = project.calculation;
  if (!c.region) add(3, 'calculation.region', 'Choose the region.');
  else if (!ctx.activeRegions.includes(c.region)) {
    add(3, 'calculation.region', 'No rule pack is available for this region yet.');
  }
  if (c.upstreamFaultMva === null) {
    add(3, 'calculation.upstreamFaultMva', 'Enter the upstream short-circuit capacity.');
  } else if (!(c.upstreamFaultMva > 0)) {
    add(3, 'calculation.upstreamFaultMva', 'Must be greater than 0 MVA.');
  }
  const dfRange = PAGE1_LIMITS.demandFactor;
  for (const [code, df] of Object.entries(c.demandFactors.byLoadType)) {
    if (df.value !== null && !inRange(df.value, dfRange)) {
      const label = LOAD_TYPE_LABELS[code as keyof typeof LOAD_TYPE_LABELS];
      add(3, `calculation.demandFactors.byLoadType.${code}`, `${label}: factor must be 0-1.`);
    }
  }
  for (const [cat, df] of Object.entries(c.demandFactors.byCategory)) {
    if (df.value !== null && !inRange(df.value, dfRange)) {
      const label = DEMAND_CATEGORY_LABELS[cat as keyof typeof DEMAND_CATEGORY_LABELS];
      add(3, `calculation.demandFactors.byCategory.${cat}`, `${label}: factor must be 0-1.`);
    }
  }

  // Card 4 - Floors & elevations
  const b = project.building;
  if (b.floors.length === 0) {
    add(4, 'building.registry', 'Generate the floor registry.');
  } else {
    const h = PAGE1_LIMITS.floorHeightM;
    for (const f of b.floors) {
      if (f.heightM === null)
        add(4, `floor.${f.id}.height`, `${f.code}: enter the floor-to-floor height.`);
      else if (!inRange(f.heightM, h)) {
        add(4, `floor.${f.id}.height`, `${f.code}: height must be ${h.min}-${h.max} m.`);
      }
    }
    const ids = new Set(b.floors.map((f) => f.id));
    b.mechanicalFloorIds.forEach((id, i) => {
      if (id !== null && !ids.has(id)) {
        add(
          4,
          `building.mechanicalFloor${i + 1}`,
          `Mechanical floor ${i + 1} is not in the registry.`,
        );
      }
    });
  }

  // Card 5 - Discipline assignment (no working directory, D-18)
  if (project.disciplines.electrical.length === 0) {
    add(5, 'disciplines.electrical', 'Assign at least one Electrical engineer.');
  }

  // Card 6 - Floor plans
  if (b.floors.length > 0 && !b.floors.some((f) => planStatus(f) === 'Calibrated')) {
    add(6, 'plans', 'Upload and calibrate the plan of at least one floor.');
  }

  return issues;
}
