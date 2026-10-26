import { z } from 'zod';
import { ModelPointSchema } from './elements.js';

/**
 * Cable = network edge (FR-15, 12.3 "Cable"). Construction is chosen while drawing (D-05);
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

/** Engineer locks (D-04): a locked value is validated only, never re-sized. */
export const CableLocksSchema = z.object({
  sizeMm2: z.number().positive().nullable(),
  runs: z.number().int().positive().nullable(),
  eccMm2: z.number().positive().nullable(),
});

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
  construction: CableConstructionSchema,
  locks: CableLocksSchema,
});
export type Cable = z.infer<typeof CableSchema>;
