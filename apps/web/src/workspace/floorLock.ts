import {
  DisciplineSchema,
  isFlagged,
  type Cable,
  type Element,
  type Project,
} from '@neuromep/shared';
import type { ProjectAction } from './projectReducer';

/**
 * Does the action change a floor flagged done (A-08, E1003)? Components and cables of the flagged
 * discipline and the plan of a flagged floor are locked for everyone until the Lead reopens it.
 * The API checks the same (`lockedChange`).
 */
export function touchesLockedFloor(project: Project, action: ProjectAction): boolean {
  const { elements, cables, floorFlags } = project.model;
  const element = (e: Element | undefined) => !!e && isFlagged(floorFlags, e.floorId, e.discipline);
  const cable = (c: Cable | undefined) => !!c && isFlagged(floorFlags, c.floorId, 'electrical');
  const byId = (id: string) => elements.find((e) => e.id === id);
  const cableById = (id: string) => cables.find((c) => c.id === id);
  // Moving or removing a component also moves or removes its cables.
  const withCables = (id: string) =>
    element(byId(id)) ||
    cables.some((c) => (c.from.elementId === id || c.to.elementId === id) && cable(c));
  switch (action.type) {
    case 'placeElement':
      return element(action.element);
    case 'updateElement':
      return element(byId(action.id));
    case 'moveElement':
      return withCables(action.id);
    case 'removeElements':
      return action.ids.some(withCables);
    case 'addCable':
      return cable(action.cable);
    case 'updateCable':
      return cable(cableById(action.id));
    case 'removeCables':
      return action.ids.some((id) => cable(cableById(id)));
    case 'loadImport':
      return action.changes.some((c) => element(byId(c.id)));
    case 'planUploaded':
    case 'calibration':
      return DisciplineSchema.options.some((d) => isFlagged(floorFlags, action.floorId, d));
    default:
      return false;
  }
}
