import { CalculationCheckSchema, DemandCategorySchema, LoadTypeCodeSchema } from './enums.js';
import { PROJECT_SCHEMA_VERSION, type DefaultableNumber, type Project } from './schema.js';

const untouched = (): DefaultableNumber => ({ value: null, source: 'rulepack' });

/** An empty project as created by "New Project" (D-13). Region defaults load when a region is chosen. */
export function createEmptyProject(args: { id: string; userId: string; now: string }): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: args.id,
    rulePackId: null,
    rulePackVersion: null,
    version: 0,
    details: {
      name: '',
      location: '',
      clientName: '',
      plotRef: '',
      designStage: null,
      revision: '',
      category: null,
      plotLoad: { value: null, unit: 'kVA' },
    },
    site: {
      ambientAirC: untouched(),
      ambientSoilC: untouched(),
      soilResistivity: untouched(),
      altitudeM: null,
    },
    calculation: {
      region: null,
      upstreamFaultMva: null,
      checks: Object.fromEntries(
        CalculationCheckSchema.options.map((c) => [c, true]),
      ) as Project['calculation']['checks'],
      demandFactors: {
        byLoadType: Object.fromEntries(
          LoadTypeCodeSchema.options.map((c) => [c, untouched()]),
        ) as Project['calculation']['demandFactors']['byLoadType'],
        byCategory: Object.fromEntries(
          DemandCategorySchema.options.map((c) => [c, untouched()]),
        ) as Project['calculation']['demandFactors']['byCategory'],
      },
      defaultOverrides: {},
    },
    building: {
      counts: { basements: null, podiums: null, typicals: null },
      gfLevelM: 0,
      mechanicalFloorIds: [null, null, null],
      floors: [],
    },
    disciplines: { electrical: [], mechanical: [], phe: [] },
    auditLog: [],
    meta: { createdAt: args.now, createdBy: args.userId, updatedAt: args.now, lastPage: 'setup' },
  };
}
