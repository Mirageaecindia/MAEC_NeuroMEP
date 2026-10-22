import { z } from 'zod';

/** Design stages (design doc 12.1, glossary). */
export const DesignStageSchema = z.enum(['CD', 'SD', 'DD', 'TD', 'IFC']);
export type DesignStage = z.infer<typeof DesignStageSchema>;
export const DESIGN_STAGE_LABELS: Record<DesignStage, string> = {
  CD: 'Concept',
  SD: 'Schematic',
  DD: 'Design Development',
  TD: 'Tender Design',
  IFC: 'Issued for Construction',
};

/** Project category (design doc 12.1). */
export const ProjectCategorySchema = z.enum([
  'RESIDENTIAL',
  'HOTEL',
  'MIXED_USE',
  'OFFICE',
  'MALL',
  'HOSPITAL',
  'SCHOOL',
  'INDUSTRIAL',
  'AIRCRAFT_HANGARS',
  'OTHERS',
]);
export type ProjectCategory = z.infer<typeof ProjectCategorySchema>;
export const PROJECT_CATEGORY_LABELS: Record<ProjectCategory, string> = {
  RESIDENTIAL: 'Residential',
  HOTEL: 'Hotel',
  MIXED_USE: 'Mixed-use',
  OFFICE: 'Office',
  MALL: 'Mall',
  HOSPITAL: 'Hospital',
  SCHOOL: 'School',
  INDUSTRIAL: 'Industrial',
  AIRCRAFT_HANGARS: 'Aircraft Hangars',
  OTHERS: 'Others',
};

/** Regions with rule packs (FR-04, D-09). Only Dubai is active in v1. */
export const RegionSchema = z.enum(['dubai', 'abu-dhabi', 'others']);
export type Region = z.infer<typeof RegionSchema>;
export const REGION_LABELS: Record<Region, string> = {
  dubai: 'Dubai',
  'abu-dhabi': 'Abu Dhabi',
  others: 'Others',
};

/**
 * Load type codes 1-12 (design doc Appendix B); labels as on the Project Set-up slide (D-19).
 * Code 13 (PFC) is internal and not listed here.
 */
export const LoadTypeCodeSchema = z.enum([
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
]);
export type LoadTypeCode = z.infer<typeof LoadTypeCodeSchema>;
export const LOAD_TYPE_LABELS: Record<LoadTypeCode, string> = {
  '1': 'Lighting',
  '2': 'Power',
  '3': 'AC',
  '4': 'Heater',
  '5': 'Laundry',
  '6': 'Kitchen',
  '7': 'Hand Dryer',
  '8': 'Pumps',
  '9': 'Fire Pumps',
  '10': 'Special Equipment',
  '11': 'Lifts & Equipment',
  '12': 'Spare',
};

/** Demand-factor categories for Dubai (design doc 12.1). */
export const DemandCategorySchema = z.enum(['residential', 'landlord', 'office', 'retail']);
export type DemandCategory = z.infer<typeof DemandCategorySchema>;
export const DEMAND_CATEGORY_LABELS: Record<DemandCategory, string> = {
  residential: 'Residential',
  landlord: 'Landlord',
  office: 'Office',
  retail: 'Retail',
};

/** Calculation checks (FR-04). Disabled checks are still computed and shown as "Not verified". */
export const CalculationCheckSchema = z.enum([
  'currentCarryingCapacity',
  'voltageDrop',
  'shortCircuit',
  'letThroughEnergy',
  'earthFaultLoopImpedance',
]);
export type CalculationCheck = z.infer<typeof CalculationCheckSchema>;
export const CALCULATION_CHECK_LABELS: Record<CalculationCheck, string> = {
  currentCarryingCapacity: 'Current Carrying Capacity',
  voltageDrop: 'Voltage Drop',
  shortCircuit: 'Short-circuit',
  letThroughEnergy: 'Let-through Energy',
  earthFaultLoopImpedance: 'Earth Fault Loop Impedance',
};

/** ISO A-series sheet sizes in millimetres (portrait width x height). */
export const SheetSizeSchema = z.enum(['A0', 'A1', 'A2', 'A3', 'A4']);
export type SheetSize = z.infer<typeof SheetSizeSchema>;
export const SHEET_SIZES_MM: Record<SheetSize, { w: number; h: number }> = {
  A0: { w: 841, h: 1189 },
  A1: { w: 594, h: 841 },
  A2: { w: 420, h: 594 },
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
};

/** Working pages, used to reopen a project on its last page (D-13). */
export const PageKeySchema = z.enum([
  'setup',
  'floor-modelling',
  'building-modelling',
  'architecture',
  'simulation-report',
]);
export type PageKey = z.infer<typeof PageKeySchema>;
