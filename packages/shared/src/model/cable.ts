import { z } from 'zod';
import { IpRatingSchema, ModelPointSchema } from './elements.js';

/**
 * Feeder = network edge: a cable, or a point-to-point (feeder-type) busbar (decision 1 Nov 2026).
 * Tap-off busbars are the risers of the Building tab. Cable = network edge (FR-15, 12.3 "Cable"). Construction is chosen while drawing (D-05);
 * size, runs and ECC are calculated by Cable Size unless locked (D-04).
 */

const Id = z.string().min(1);

export const CableEndSchema = z.object({
  elementId: Id,
  /** 'in' / 'out', or 'normal' / 'standby' on an ATS. */
  port: z.enum(['in', 'out', 'normal', 'standby']),
});

export const CableConstructionSchema = z
  .object({
    cores: z.enum(['1C', '2C', '3C', '4C']),
    conductor: z.enum(['Cu', 'Al']),
    insulation: z.enum(['PVC', 'XLPE', 'FR']),
    armour: z.enum(['SWA', 'AWA', 'none']),
    sheath: z.enum(['PVC', 'LSZH']),
    voltageGrade: z.enum(['450/750 V', '300/500 V', '600/1000 V']),
    method: z.enum(['B', 'J', 'D-direct', 'D-duct']),
    trays: z.number().int().positive().nullable(),
    depthM: z.number().positive().nullable(),
    separation: z.string().nullable(),
    groupedCircuits: z.number().int().positive().nullable(),
  })
  // 12.3: single-core cables are AWA only.
  .refine((c) => c.cores !== '1C' || c.armour !== 'SWA', {
    message: 'Single-core cables take AWA armour (or none), not SWA.',
    path: ['armour'],
  });
export type CableConstruction = z.infer<typeof CableConstructionSchema>;

/**
 * Separation between grouped cables per installation method (component sheet, 12.3; CableSizer
 * grouping tables): D = one cable diameter, metres for buried cables. Conduit (B) has none.
 */
export const SEPARATIONS: Record<CableConstruction['method'], readonly string[]> = {
  B: [],
  J: ['touching', 'D', '2D'],
  'D-direct': ['touching', '0.15', '0.30', '0.45', '0.60'],
  'D-duct': ['touching', '0.45', '0.60'],
};

/**
 * Installation choices as dropdowns, exactly as the components sheet "6. Installation
 * Method/Condition" (user decision 26 Nov 2026): number of trays 1-3 (tray, method J; the GROUPJ
 * table's rows) and depth of laying in metres for buried and duct cables (DLAY table steps).
 */
export const TRAY_COUNTS: readonly number[] = [1, 2, 3];
export const LAYING_DEPTHS_M: readonly number[] = [0.6, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];

/** Engineer locks (D-04): a locked value is validated only, never re-sized. */
export const CableLocksSchema = z.object({
  sizeMm2: z.number().positive().nullable(),
  runs: z.number().int().positive().nullable(),
  eccMm2: z.number().positive().nullable(),
});

/** Feeder drawn on the plan: cable (default) or busbar. */
export const FeederTypeSchema = z.enum(['cable', 'busbar']);
export type FeederType = z.infer<typeof FeederTypeSchema>;

/**
 * Busbar feeder fields entered by the engineer (12.3, TPN+E, 600/1000 V). Rating, length and
 * fault duty are calculated; R, X and Icw come from the manufacturer datasheet (OI-13).
 */
export const BusbarSpecSchema = z.object({
  conductor: z.enum(['Cu', 'Al']),
  ipRating: IpRatingSchema.nullable(),
  fireRated: z.boolean(),
});
export type BusbarSpec = z.infer<typeof BusbarSpecSchema>;
export const DEFAULT_BUSBAR: BusbarSpec = { conductor: 'Cu', ipRating: null, fireRated: false };

export const CableSchema = z.object({
  id: Id,
  version: z.number().int().nonnegative(),
  /** F<floor>-<hierarchy>, e.g. F2-3-1-1 (12.4). */
  tag: z.string().min(1),
  from: CableEndSchema,
  to: CableEndSchema,
  /** Outgoing way on the source panel, e.g. 1RYB, 2R (FR-15). */
  circuitRef: z.string(),
  floorId: Id,
  /** Orthogonal route in metres on the floor, end points included. */
  route: z.array(ModelPointSchema).min(2),
  /** Vertical runs added to the routed length (m). */
  verticalM: z.number().nonnegative(),
  /**
   * Length typed by the engineer (m) for a feeder drawn in the Building tab - between floors, where
   * nothing can be measured on a plan (user request 8 Nov 2026). Used as the whole length.
   */
  manualLengthM: z.number().positive().optional(),
  /**
   * Corners of a feeder drawn in the Building tab, in that diagram's units (user request 9 Nov
   * 2026: the engineer draws the path, as on a plan). Drawing only: the length is typed.
   */
  buildingRoute: z.array(ModelPointSchema).optional(),
  /**
   * The same corners tied to the diagram's layout (18 Nov 2026), so they move with it when
   * components are added or the spacing changes: the floor row, the offset from its line, and the
   * position in component slots (0 = the first component's centre). Replaces buildingRoute.
   */
  buildingPath: z
    .array(z.object({ floorId: z.string().min(1), dy: z.number(), slot: z.number() }))
    .optional(),
  feederType: FeederTypeSchema.default('cable'),
  /** Kept while the feeder is a cable, so switching back and forth loses nothing. */
  busbar: BusbarSpecSchema.optional(),
  /** Cable construction (also kept while the feeder is a busbar). */
  construction: CableConstructionSchema,
  locks: CableLocksSchema,
  /**
   * Breaker type chosen by the engineer in the calculation sheet (27 Nov 2026, A-34); null or
   * missing = the default logic (MCCB below 800 A, ACB from 800 A, PFC MCCB). A different choice
   * is flagged W2004 and never moved up automatically.
   */
  breakerType: z.enum(['MCCB', 'ACB']).nullable().optional(),
});
export type Cable = z.infer<typeof CableSchema>;
