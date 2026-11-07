import { DemandCategorySchema, LoadTypeCodeSchema } from './enums.js';
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
      system: { voltageLineV: untouched(), voltagePhaseV: untouched(), frequencyHz: untouched() },
      checks: {
        currentCarryingCapacity: true,
        voltageDrop: true,
        shortCircuit: true,
        letThroughEnergy: true,
        earthFaultLoopImpedance: true,
      },
      demandFactors: {
        byLoadType: Object.fromEntries(
          LoadTypeCodeSchema.options.map((c) => [c, untouched()]),
        ) as Project['calculation']['demandFactors']['byLoadType'],
        byCategory: Object.fromEntries(
          DemandCategorySchema.options.map((c) => [c, untouched()]),
        ) as Project['calculation']['demandFactors']['byCategory'],
        secondLevel: untouched(),
      },
      demandMethod: 'dubai-non-emaar',
      busbarMaker: null,
      defaultOverrides: {},
    },
    building: {
      counts: { basements: null, grounds: 1, podiums: null, typicals: null },
      gfLevelM: 0,
      mechanicalFloorIds: [],
      floors: [],
    },
    workingDirectory: '',
    disciplines: { electrical: [], mechanical: [], phe: [] },
    model: {
      elements: [],
      cables: [],
      risers: [],
      floorFlags: [],
      results: [],
      generatorFactors: [],
    },
    auditLog: [],
    meta: { createdAt: args.now, createdBy: args.userId, updatedAt: args.now, lastPage: 'setup' },
  };
}
