import type { Project } from '../project/schema.js';
import type { Element } from './elements.js';

/** Boards whose schedules a change can alter (design doc Section 9: "floors, panels, cables"). */
const PANEL_KINDS = new Set<Element['kind']>([
  'lv-panel',
  'mdb',
  'emdb',
  'acb-panel',
  'smdb',
  'esmdb',
  'mcc',
  'emcc',
  'db',
]);

export interface ModelImpact {
  /** Names of the floors that hold modelled components, in registry order. */
  floors: string[];
  panels: number;
  cables: number;
}

/**
 * What a change to an earlier page reaches (Section 9, "Changes to earlier pages"): every
 * modelled floor, panel and cable, since Page 1 inputs (site conditions, demand factors, checks,
 * floors) feed every calculation. Empty when nothing has been modelled yet.
 */
export function modelImpact(project: Pick<Project, 'model' | 'building'>): ModelImpact {
  const used = new Set(project.model.elements.map((e) => e.floorId));
  return {
    floors: project.building.floors.filter((f) => used.has(f.id)).map((f) => f.name),
    panels: project.model.elements.filter((e) => PANEL_KINDS.has(e.kind)).length,
    cables: project.model.cables.length,
  };
}

export const hasModel = (impact: ModelImpact) => impact.floors.length > 0 || impact.cables > 0;

/** "2 floors (Ground Floor, First Floor), 3 panels and 4 cables" */
export function describeImpact(impact: ModelImpact): string {
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const floors = impact.floors.length
    ? `${n(impact.floors.length, 'floor')} (${impact.floors.join(', ')})`
    : n(0, 'floor');
  return `${floors}, ${n(impact.panels, 'panel')} and ${n(impact.cables, 'cable')}`;
}
