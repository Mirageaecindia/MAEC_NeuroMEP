import { DemandCategorySchema, LoadTypeCodeSchema, RegionSchema } from '@neuromep/shared';
import { z } from 'zod';

const NullableFactor = z.number().min(0).max(1).nullable();

/** A calculation default from design doc 12.2. `value: null` = TBC (shown as TBC, never invented). */
export const CalculationDefaultSchema = z.strictObject({
  key: z.string().min(1),
  group: z.string(),
  label: z.string(),
  unit: z.string().optional(),
  type: z.enum(['number', 'text']),
  value: z.union([z.number(), z.string(), z.null()]),
  /** Interim default from design doc Section 18 - recorded, but not applied as the value. */
  interimDefault: z.union([z.number(), z.string(), z.null()]).optional(),
  openItem: z.string().optional(),
  note: z.string().optional(),
});
export type CalculationDefault = z.infer<typeof CalculationDefaultSchema>;

/** Device data (Appendix B, 10.5): generic breakers until the catalogue arrives (OI-03). */
export const DevicesSchema = z.strictObject({
  note: z.string(),
  breakerRatingsA: z.array(z.number().positive()),
  cableSizesMm2: z.array(z.number().positive()),
  trayWidthsMm: z.array(z.number().positive()),
  dewaMinimumCable: z.strictObject({
    note: z.string(),
    rows: z.array(
      z.strictObject({
        breakerA: z.number().positive(),
        sizeMm2: z.number().positive(),
        runs: z.number().int().positive(),
      }),
    ),
  }),
  breakerTypes: z.array(
    z.strictObject({
      type: z.enum(['MCB', 'MCCB', 'ACB']),
      maxRatingA: z.number().positive(),
      faultRatingsKa: z.array(z.number().positive()),
      interim: z.boolean(),
      note: z.string(),
    }),
  ),
});
export type Devices = z.infer<typeof DevicesSchema>;
export type BreakerType = Devices['breakerTypes'][number]['type'];

/**
 * Source impedance data for short circuits (manager's answers 3 Nov 2026, Q9): transformer
 * impedance voltage by rating and primary voltage class (manufacturer catalogue), and typical
 * generator sub-transient reactance ranges by rating.
 */
export const SourceDataSchema = z.strictObject({
  transformerUkPct: z.array(
    z.strictObject({
      /** Primary voltage up to this value (kV) uses this row set. */
      maxPrimaryKv: z.number().positive(),
      rows: z.array(
        z.strictObject({ maxKva: z.number().positive(), ukPct: z.number().positive() }),
      ),
    }),
  ),
  generatorXdPct: z.array(
    z.strictObject({
      maxKva: z.number().positive(),
      low: z.number().positive(),
      high: z.number().positive(),
    }),
  ),
});
export type SourceData = z.infer<typeof SourceDataSchema>;

/** Dubai demand-category factor sets (manager's answers 3 Nov 2026). */
export const DemandMethodSetSchema = z.strictObject({
  byCategory: z.record(DemandCategorySchema, z.number().min(0).max(1)),
  /** Factor at the SMDB level; 1 = none. */
  secondLevel: z.number().min(0).max(1),
});

export const RulePackSchema = z.strictObject({
  id: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  region: RegionSchema,
  name: z.string(),
  sources: z.string(),
  siteDefaults: z.strictObject({
    ambientAirC: z.number(),
    ambientSoilC: z.number(),
    soilResistivity: z.number(),
  }),
  demandFactors: z.strictObject({
    note: z.string().optional(),
    byLoadType: z.record(LoadTypeCodeSchema, NullableFactor),
    byCategory: z.record(DemandCategorySchema, NullableFactor),
  }),
  calculationDefaults: z.array(CalculationDefaultSchema),
  devices: DevicesSchema,
  sourceData: SourceDataSchema,
  demandMethods: z.strictObject({
    'dubai-non-emaar': DemandMethodSetSchema,
    'dubai-emaar': DemandMethodSetSchema,
  }),
});
export type RulePack = z.infer<typeof RulePackSchema>;
