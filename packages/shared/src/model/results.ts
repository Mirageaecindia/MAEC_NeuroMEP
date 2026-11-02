import { z } from 'zod';

/**
 * Results of a Cable Size run (FR-18, 10.12-10.13). Stored with run ID, engine and rule-pack
 * version so any result can be replayed (Section 4, Engine trace). The engine (WBS 1.6) fills them.
 */

export const CheckCodeSchema = z.enum([
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'C11',
  'C12',
]);
export type CheckCode = z.infer<typeof CheckCodeSchema>;

export const CHECK_LABELS: Record<CheckCode, string> = {
  C1: 'Current-carrying capacity',
  C2: 'Voltage drop',
  C3: 'Breaking / making capacity',
  C4: 'Thermal withstand',
  C5: 'Earth-fault loop / disconnection',
  C6: 'Regional minimum size',
  C7: 'Switchboard / busbar withstand',
  C8: 'Safety category',
  C9: 'Fire-rated path',
  C10: 'Neutral / harmonics',
  C11: 'Motor / fire-pump starting',
  C12: 'Loading',
};

/** Outcome of one check. 'not-calculated' = not ticked on Page 1 (FR-04). */
export const CheckResultSchema = z.object({
  state: z.enum(['pass', 'fail', 'warning', 'not-calculated', 'not-required', 'blocked']),
  /** e.g. "Not required - ELCB upstream", or the failing values. */
  detail: z.string().optional(),
});

export const ResultStatusSchema = z.enum([
  'final',
  'provisional',
  'awaiting-load',
  'blocked',
  'out-of-date',
]);

/** Why a result is Provisional (10.13, E1901, V-12). */
export const ProvisionalReasonSchema = z.enum([
  'upstream-not-connected',
  'demand-factors-tbc',
  /** No longer produced since 2 Nov 2026 (CableSizer tables approved); kept for stored results. */
  'unverified-ampacity-tables',
]);
export type ProvisionalReason = z.infer<typeof ProvisionalReasonSchema>;

export const ElementResultSchema = z.object({
  elementId: z.string().min(1),
  status: ResultStatusSchema,
  provisionalReasons: z.array(ProvisionalReasonSchema),
  /** Error codes raised on this element (Appendix D). */
  errors: z.array(z.string().regex(/^E\d{4}$/)),
  /** Check that decided the size ("Sized by"). */
  sizedBy: CheckCodeSchema.nullable(),
  checks: z.partialRecord(CheckCodeSchema, CheckResultSchema),
  /** Cables / feeders. */
  size: z
    .object({
      runs: z.number().int().positive(),
      cores: z.enum(['1C', '2C', '3C', '4C']),
      sizeMm2: z.number().positive(),
      eccMm2: z.number().positive(),
      lengthM: z.number().nonnegative(),
    })
    .nullable(),
  device: z
    .object({
      type: z.enum(['MCB', 'MCCB', 'ACB']),
      ratingA: z.number().positive(),
      poles: z.enum(['1P', '3P', '4P']),
      faultRatingKa: z.number().positive().nullable(),
    })
    .nullable(),
  /** Connected and maximum-demand load (kW) per phase. */
  load: z
    .object({
      connectedKw: z.object({ L1: z.number(), L2: z.number(), L3: z.number() }),
      maxDemandKw: z.number(),
      standbyKw: z.number().nullable(),
    })
    .nullable(),
  values: z.object({
    ibA: z.number().nullable(),
    inA: z.number().nullable(),
    izA: z.number().nullable(),
    vdOwnPct: z.number().nullable(),
    vdTotalPct: z.number().nullable(),
    ikMaxKa: z.number().nullable(),
    ikMinKa: z.number().nullable(),
    ipKa: z.number().nullable(),
    zsMohm: z.number().nullable(),
  }),
  /** Calculation trace: inputs, table values with reference, formulas (FR-18). */
  trace: z.array(z.object({ step: z.string(), detail: z.string() })),
});
export type ElementResult = z.infer<typeof ElementResultSchema>;

export const CableSizeRunSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('element'), elementId: z.string() }),
    z.object({ kind: z.literal('floor'), floorId: z.string() }),
    z.object({ kind: z.literal('project') }),
  ]),
  startedAt: z.iso.datetime({ offset: true }),
  engineVersion: z.string(),
  rulePackId: z.string(),
  rulePackVersion: z.string(),
  /** Model version the run used; later edits make results "Out of date" (FR-21). */
  modelVersion: z.number().int().nonnegative(),
  results: z.array(ElementResultSchema),
});
export type CableSizeRun = z.infer<typeof CableSizeRunSchema>;
