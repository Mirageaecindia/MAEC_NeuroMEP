import { z } from 'zod';
import { DemandCategorySchema, LoadTypeCodeSchema } from '../project/enums.js';

/**
 * Network elements (design doc Section 3 hierarchy, 12.3 equipment fields, 13 component codes).
 * Positions are stored in metres on the floor (after calibration), never in PDF units, so a plan
 * can be replaced without moving the model (Section 7, Floor-Plan Handling).
 */

const Id = z.string().min(1);

/** Point on a floor in metres (plan origin = PDF page origin x metres per unit). */
export const ModelPointSchema = z.object({ x: z.number(), y: z.number() });
export type ModelPoint = z.infer<typeof ModelPointSchema>;

export const DisciplineSchema = z.enum(['electrical', 'mechanical', 'phe']);
export type Discipline = z.infer<typeof DisciplineSchema>;

export const IpRatingSchema = z.enum(['IP23', 'IP42', 'IP54', 'IP55', 'IP65']);
export const PolesSchema = z.enum(['SP', 'TP', 'SPN', 'TPN']);
export const LoadCategorySchema = z.enum(['normal', 'essential', 'critical', 'fls']);
export type LoadCategory = z.infer<typeof LoadCategorySchema>;
export const DeviceTypeSchema = z.enum(['MCB', 'MCCB', 'ACB', 'isolator']);
export const EarthLeakageSchema = z.enum([
  'none',
  'ELCB 30 mA',
  'ELCB 100 mA',
  'ELS 0-300 mA',
  'ELS 0-500 mA',
]);
export const MountingSchema = z.enum(['wall mounted', 'recessed', 'floor mounted']);
export const StarterSchema = z.enum(['DOL', 'star-delta', 'soft starter', 'VFD']);

/**
 * Connected load of a load point (FR-17): kW per phase per load type, or area x W/m2.
 * One line per load type; values are connected load (before demand factors).
 */
export const LoadLineSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('kw'),
    loadType: LoadTypeCodeSchema,
    kwL1: z.number().nonnegative(),
    kwL2: z.number().nonnegative(),
    kwL3: z.number().nonnegative(),
  }),
  z.object({
    method: z.literal('area'),
    loadType: LoadTypeCodeSchema,
    areaM2: z.number().nonnegative(),
    wPerM2: z.number().nonnegative(),
    phases: z.enum(['L1', 'L2', 'L3', '3P']),
  }),
]);
export type LoadLine = z.infer<typeof LoadLineSchema>;

/** Fields of all equipment (12.3 "All equipment"). fed_from / feeding_to are derived from cables. */
const base = {
  id: Id,
  /** Optimistic-locking counter per element (FR-10, Section 8). */
  version: z.number().int().nonnegative(),
  tag: z.string().min(1),
  description: z.string(),
  floorId: Id,
  position: ModelPointSchema,
  /** Size of the symbol on the plan, 1 = standard (drawing only, never used in calculations). */
  symbolScale: z.number().min(0.5).max(4).optional(),
  /** Location / room; may be suggested from the nearest PDF text label. */
  location: z.string(),
  discipline: DisciplineSchema,
  ipRating: IpRatingSchema.nullable(),
  fireRated: z.boolean(),
  /** Library item it was placed from (its legend symbol and name, A-11); absent for older data. */
  libraryKey: z.string().optional(),
};

/** Fields shared by boards (LV panel / MDB / EMDB / SMDB / ESMDB / MCC / EMCC / DB). */
const board = {
  poles: z.enum(['SPN', 'TPN']),
  loadCategory: LoadCategorySchema,
  incomerDevice: DeviceTypeSchema,
  earthLeakage: EarthLeakageSchema,
  mounting: MountingSchema.nullable(),
  /** Standby load where nothing is connected downstream (otherwise acquired). */
  standbyKw: z.number().nonnegative().nullable(),
};

export const EbUtilitySchema = z.object({ ...base, kind: z.literal('eb-utility') });

export const TransformerSchema = z.object({
  ...base,
  kind: z.literal('transformer'),
  kva: z.number().positive().nullable(),
  primaryV: z.number().positive().nullable(),
  ukPct: z.number().positive().nullable(),
  urPct: z.number().positive().nullable(),
  vectorGroup: z.string(),
});

export const GeneratorSchema = z.object({
  ...base,
  kind: z.enum(['generator', 'ups']),
  /** Calculated from the MD of the panel fed directly unless overridden. */
  kvaOverride: z.number().positive().nullable(),
  xdSubtransientPct: z.number().positive().nullable(),
  sustainedScKa: z.number().positive().nullable(),
});

export const AtsSchema = z.object({ ...base, kind: z.literal('ats') });

/** L2 main boards and L4 sub-main boards (12.3 "LV Panel / MDB / SMDB / ESMDB"). */
export const PanelSchema = z.object({
  ...base,
  ...board,
  kind: z.enum(['lv-panel', 'mdb', 'emdb', 'acb-panel', 'smdb', 'esmdb']),
  demandCategories: z.array(DemandCategorySchema),
  /** Manual load for outgoing ways not connected to equipment (FR-17, 10.3). */
  manualLoads: z.array(LoadLineSchema),
  icwKa: z.number().positive().nullable(),
  ipkKa: z.number().positive().nullable(),
  /** Per-panel demand-factor overrides (D-03), keyed by load type code. */
  demandFactorOverrides: z.record(z.string(), z.number().min(0).max(1)),
});

export const MccSchema = z.object({
  ...base,
  ...board,
  kind: z.enum(['mcc', 'emcc']),
  demandCategories: z.array(DemandCategorySchema),
});

export const DbSchema = z.object({
  ...base,
  ...board,
  kind: z.literal('db'),
  demandCategory: DemandCategorySchema.nullable(),
  loads: z.array(LoadLineSchema),
  powerFactor: z.number().min(0.5).max(1).nullable(),
  thirdHarmonicPct: z.number().min(0).max(100).nullable(),
});

export const BusbarSchema = z.object({
  ...base,
  kind: z.literal('busbar'),
  busbarType: z.enum(['feeder', 'tap-off']),
  conductor: z.enum(['Cu', 'Al']),
  /** Floors a riser serves (Building view, FR-20). */
  servedFloorIds: z.array(Id),
});

/** Tap-off boxes, isolators, connection units and motors: load points below a board or busbar. */
export const LoadPointSchema = z.object({
  ...base,
  kind: z.enum(['tap-off-box', 'isolator', 'connection-unit', 'motor']),
  poles: PolesSchema,
  loadCategory: LoadCategorySchema,
  demandCategory: DemandCategorySchema.nullable(),
  /** Load where no equipment is connected (otherwise acquired from it). */
  manualLoads: z.array(LoadLineSchema),
  standbyKw: z.number().nonnegative().nullable(),
  earthLeakage: EarthLeakageSchema,
  efficiency: z.number().min(0.5).max(1).nullable(),
  starter: StarterSchema.nullable(),
});

export const PfcBankSchema = z.object({
  ...base,
  kind: z.literal('pfc-bank'),
  incomerDevice: z.enum(['MCCB', 'ACB', 'isolator']),
  detuned: z.boolean(),
});

/**
 * Mechanical / PHE equipment (briefing page 9, user request 6 Nov 2026): placed by the mechanical
 * or PHE engineer on their own layer and linked to the isolator or connection unit that feeds it
 * ("Fed from", no cable - Phase 1 ends at the isolator). kW is the rated output; the input load is
 * kW / efficiency - required with a starter (motor-driven), 1.0 when empty otherwise.
 */
export const EquipmentSchema = z.object({
  ...base,
  kind: z.literal('equipment'),
  fedFromId: Id.nullable(),
  kw: z.number().positive().nullable(),
  phases: z.enum(['3P', 'L1', 'L2', 'L3']),
  powerFactor: z.number().min(0.5).max(1).nullable(),
  efficiency: z.number().min(0.5).max(1).nullable(),
  starter: StarterSchema.nullable(),
  loadType: LoadTypeCodeSchema,
  fls: z.boolean(),
});
export type Equipment = z.infer<typeof EquipmentSchema>;

export const ElementSchema = z.discriminatedUnion('kind', [
  EbUtilitySchema,
  TransformerSchema,
  GeneratorSchema,
  AtsSchema,
  PanelSchema,
  MccSchema,
  DbSchema,
  BusbarSchema,
  LoadPointSchema,
  PfcBankSchema,
  EquipmentSchema,
]);
export type Element = z.infer<typeof ElementSchema>;
export type ElementKind = Element['kind'];

/** Hierarchy level of each kind (design doc Section 3). */
/** L6: equipment below an isolator / connection unit, outside the sized LV network. */
export const ELEMENT_LEVEL: Record<ElementKind, 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6'> = {
  'eb-utility': 'L0',
  transformer: 'L1',
  generator: 'L1',
  ups: 'L1',
  ats: 'L1',
  'lv-panel': 'L2',
  mdb: 'L2',
  emdb: 'L2',
  'acb-panel': 'L2',
  busbar: 'L3',
  'tap-off-box': 'L3',
  smdb: 'L4',
  esmdb: 'L4',
  mcc: 'L4',
  emcc: 'L4',
  db: 'L5',
  isolator: 'L5',
  'connection-unit': 'L5',
  motor: 'L5',
  'pfc-bank': 'L2',
  equipment: 'L6',
};
