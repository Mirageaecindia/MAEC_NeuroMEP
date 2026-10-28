import { z } from 'zod';
import { CableSchema } from '../model/cable.js';
import { ElementSchema } from '../model/elements.js';
import {
  DemandCategorySchema,
  DesignStageSchema,
  LoadTypeCodeSchema,
  PageKeySchema,
  ProjectCategorySchema,
  RegionSchema,
  SheetSizeSchema,
} from './enums.js';

/** Version of the project file / document shape. Bump on breaking change and add a migration. */
export const PROJECT_SCHEMA_VERSION = 2;

const IsoDate = z.iso.datetime({ offset: true });
const Id = z.string().min(1);

/**
 * A value pre-filled from the region rule pack that the user may change.
 * `source: 'rulepack'` means untouched, so a later rule-pack load may replace it.
 */
export const DefaultableNumberSchema = z.object({
  value: z.number().nullable(),
  source: z.enum(['rulepack', 'user']),
});
export type DefaultableNumber = z.infer<typeof DefaultableNumberSchema>;

// ----- Floor plans and calibration (FR-07 to FR-09) -------------------------------------------

/** A point in PDF page user space (points, origin bottom-left) - independent of zoom and pan. */
export const PdfPointSchema = z.object({ x: z.number(), y: z.number() });
export type PdfPoint = z.infer<typeof PdfPointSchema>;

export const TwoPointCalibrationSchema = z.object({
  method: z.literal('two-point'),
  pointA: PdfPointSchema,
  pointB: PdfPointSchema,
  realDistanceM: z.number().positive(),
  metresPerUnit: z.number().positive(),
  calibratedAt: IsoDate,
  calibratedBy: Id,
  /** Optional check: a second known distance measured with this calibration. */
  verification: z
    .object({
      pointA: PdfPointSchema,
      pointB: PdfPointSchema,
      measuredM: z.number().nonnegative(),
      at: IsoDate,
    })
    .optional(),
});

/** Less reliable: assumes the PDF was produced at true sheet size. */
export const DrawingScaleCalibrationSchema = z.object({
  method: z.literal('drawing-scale'),
  /** 100 for a 1:100 drawing. */
  scaleDenominator: z.number().positive(),
  sheetSize: SheetSizeSchema,
  metresPerUnit: z.number().positive(),
  calibratedAt: IsoDate,
  calibratedBy: Id,
});

export const CalibrationSchema = z.discriminatedUnion('method', [
  TwoPointCalibrationSchema,
  DrawingScaleCalibrationSchema,
]);
export type Calibration = z.infer<typeof CalibrationSchema>;

export const PdfPlanSchema = z.object({
  kind: z.literal('pdf'),
  /** Stored file (GridFS / object storage id). */
  fileId: Id,
  fileName: z.string().min(1),
  uploadedAt: IsoDate,
  uploadedBy: Id,
  /** Page 1 size in PDF units (points); calibration points are in this space. */
  page: z.object({ widthPt: z.number().positive(), heightPt: z.number().positive() }),
  calibration: CalibrationSchema.nullable(),
  /**
   * The plan this one replaced, kept so it can be aligned to the new one (FR-09).
   * EXTENSION POINT: alignment and the out-of-extents check need Page 2 components.
   */
  replaced: z
    .object({
      fileId: Id,
      fileName: z.string(),
      page: z.object({ widthPt: z.number(), heightPt: z.number() }),
      calibration: CalibrationSchema.nullable(),
      replacedAt: IsoDate,
      alignment: z.literal('pending'),
    })
    .optional(),
});
export type PdfPlan = z.infer<typeof PdfPlanSchema>;

/**
 * Where a floor's drawing comes from. Only PDF uploads exist today; a Revit import will add a
 * `{ kind: 'revit', ... }` variant here, so the floor registry itself does not change.
 */
export const PlanSourceSchema = z.discriminatedUnion('kind', [PdfPlanSchema]);
export type PlanSource = z.infer<typeof PlanSourceSchema>;

export const FloorTypeSchema = z.enum(['basement', 'ground', 'podium', 'typical']);
export type FloorType = z.infer<typeof FloorTypeSchema>;

export const FloorSchema = z.object({
  id: Id,
  /** B2, B1, GF, P1, 1, 2 ... - generated, unique within the project. */
  code: z.string().min(1),
  name: z.string(),
  type: FloorTypeSchema,
  /** Floor-to-floor height from this floor's level to the floor above (m). */
  heightM: z.number().nullable(),
  plan: PlanSourceSchema.nullable(),
});
export type Floor = z.infer<typeof FloorSchema>;

// ----- Project ----------------------------------------------------------------------------------

export const AuditEntrySchema = z.object({
  id: Id,
  at: IsoDate,
  userId: Id,
  /** earlierPageChange: a confirmed change to a Page 1 calculation input (Section 9). */
  area: z.enum(['demandFactor', 'calculationDefault', 'earlierPageChange']),
  key: z.string(),
  from: z.union([z.number(), z.string(), z.null()]),
  to: z.union([z.number(), z.string(), z.null()]),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: Id,
  /** Rule pack the project is calculated with (FR-31). */
  rulePackId: z.string().nullable(),
  rulePackVersion: z.string().nullable(),
  /** Optimistic-locking counter; the server increments it on every save. */
  version: z.number().int().nonnegative(),

  details: z.object({
    name: z.string(),
    location: z.string(),
    clientName: z.string(),
    plotRef: z.string(),
    designStage: DesignStageSchema.nullable(),
    revision: z.string(),
    category: ProjectCategorySchema.nullable(),
    plotLoad: z.object({ value: z.number().nullable(), unit: z.enum(['kW', 'kVA']) }),
  }),

  site: z.object({
    ambientAirC: DefaultableNumberSchema,
    ambientSoilC: DefaultableNumberSchema,
    soilResistivity: DefaultableNumberSchema,
    /** Optional; not used in Phase 1 (OI-26). */
    altitudeM: z.number().nullable(),
  }),

  calculation: z.object({
    region: RegionSchema.nullable(),
    /** System voltage and frequency (12.1), inherited by every component; rule-pack defaults. */
    system: z.object({
      voltageLineV: DefaultableNumberSchema,
      voltagePhaseV: DefaultableNumberSchema,
      frequencyHz: DefaultableNumberSchema.refine(
        (f) => f.value === null || [50, 60].includes(f.value),
        {
          message: 'Frequency is 50 or 60 Hz.',
        },
      ),
    }),
    upstreamFaultMva: z.number().nullable(),
    /** Ticked checks are calculated; ampacity is always calculated (FR-04). */
    checks: z.object({
      currentCarryingCapacity: z.literal(true),
      voltageDrop: z.boolean(),
      shortCircuit: z.boolean(),
      letThroughEnergy: z.boolean(),
      earthFaultLoopImpedance: z.boolean(),
    }),
    demandFactors: z.object({
      byLoadType: z.record(LoadTypeCodeSchema, DefaultableNumberSchema),
      byCategory: z.record(DemandCategorySchema, DefaultableNumberSchema),
    }),
    /** Technical Lead overrides of rule-pack calculation defaults (12.2), keyed by default key. */
    defaultOverrides: z.record(z.string(), z.union([z.number(), z.string()])),
  }),

  building: z.object({
    counts: z.object({
      basements: z.number().int().nullable(),
      podiums: z.number().int().nullable(),
      typicals: z.number().int().nullable(),
    }),
    /** Finished floor level of GF (m) - the datum for all other levels. */
    gfLevelM: z.number(),
    /** Mechanical floor 1-3: ids of registry floors, or null. */
    mechanicalFloorIds: z.tuple([Id.nullable(), Id.nullable(), Id.nullable()]),
    /** Ordered bottom (lowest basement) to top. Empty until the registry is generated. */
    floors: z.array(FloorSchema),
  }),

  workingDirectory: z.string(),
  disciplines: z.object({
    electrical: z.array(Id),
    mechanical: z.array(Id),
    phe: z.array(Id),
  }),

  /** Network model (Page 2): elements and cables, positions in metres (1.1.4). */
  model: z.object({
    elements: z.array(ElementSchema),
    cables: z.array(CableSchema),
  }),

  auditLog: z.array(AuditEntrySchema),

  meta: z.object({
    createdAt: IsoDate,
    createdBy: Id,
    updatedAt: IsoDate,
    lastPage: PageKeySchema,
    /** Furthest page reached; later tabs stay closed until Next (A-12). */
    reachedPage: PageKeySchema.optional(),
  }),
});
export type Project = z.infer<typeof ProjectSchema>;
