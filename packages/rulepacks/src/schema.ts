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
});
export type RulePack = z.infer<typeof RulePackSchema>;
