import { ElementSchema, type Element } from './model/elements.js';
import { createEmptyProject } from './project/factory.js';
import { generateRegistry } from './project/floors.js';
import type { Project } from './project/schema.js';

/** Test fixtures shared by the workspaces' tests. Not used by application code. */

export const FIXED_NOW = '2026-10-22T08:00:00.000Z';

export function sequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** A project that passes every Page 1 check: B1, GF, P1, 1, 2 with GF calibrated. */
export function completeProject(): Project {
  const p = createEmptyProject({ id: 'p-1', userId: 'u-lead', now: FIXED_NOW });
  p.rulePackId = 'dubai';
  p.rulePackVersion = '1.0.0';
  p.details = {
    name: 'NeoTower',
    location: 'Dubai',
    clientName: 'Client Ltd',
    plotRef: 'Plot-42B',
    designStage: 'SD',
    revision: 'A',
    category: 'OFFICE',
    plotLoad: { value: 2500, unit: 'kVA' },
  };
  p.site.ambientAirC = { value: 50, source: 'rulepack' };
  p.site.ambientSoilC = { value: 35, source: 'rulepack' };
  p.site.soilResistivity = { value: 2, source: 'rulepack' };
  p.calculation.region = 'dubai';
  p.calculation.upstreamFaultMva = 350;
  const counts = { basements: 1, podiums: 1, typicals: 2 };
  p.building.counts = counts;
  p.building.floors = generateRegistry(counts, [], sequentialIds('f')).floors.map((f) => ({
    ...f,
    heightM: 4,
  }));
  const gf = p.building.floors.find((f) => f.code === 'GF')!;
  gf.plan = {
    kind: 'pdf',
    fileId: 'file-1',
    fileName: 'GF.pdf',
    uploadedAt: FIXED_NOW,
    uploadedBy: 'u-lead',
    page: { widthPt: 2384, heightPt: 1684 },
    calibration: {
      method: 'two-point',
      pointA: { x: 100, y: 100 },
      pointB: { x: 400, y: 500 },
      realDistanceM: 50,
      metresPerUnit: 0.1,
      calibratedAt: FIXED_NOW,
      calibratedBy: 'u-lead',
    },
  };
  p.disciplines.electrical = ['u-elec'];
  p.meta.reachedPage = 'modelling'; // Page 1 complete: Floor Setup is open (A-12)
  return p;
}

/** A valid distribution board placed on `floorId`. */
export function sampleDb(floorId: string, id = 'db-1'): Element {
  return ElementSchema.parse({
    id,
    version: 0,
    tag: `DB-${id}`,
    description: 'Small power',
    floorId,
    position: { x: 12.5, y: 4 },
    location: 'Electrical room',
    discipline: 'electrical',
    ipRating: 'IP42',
    fireRated: false,
    kind: 'db',
    poles: 'TPN',
    loadCategory: 'normal',
    incomerDevice: 'MCCB',
    earthLeakage: 'ELCB 30 mA',
    mounting: 'recessed',
    standbyKw: null,
    demandCategory: 'office',
    powerFactor: 0.85,
    thirdHarmonicPct: null,
    loads: [],
  });
}

/** completeProject() after modelling has started: past Import File, one DB on the Ground Floor. */
export function modelledProject(): Project {
  const p = completeProject();
  const gf = p.building.floors.find((f) => f.code === 'GF')!;
  p.model.elements = [sampleDb(gf.id)];
  return p;
}
