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
  const floorOf = (id: string) => elements.find((e) => e.id === id)?.floorId;
  // A feeder between floors is locked by the floor at either end too (8 Nov 2026).
  const cable = (c: Cable | undefined) =>
    !!c &&
    [c.floorId, floorOf(c.from.elementId), floorOf(c.to.elementId)].some(
      (f) => !!f && isFlagged(floorFlags, f, 'electrical'),
    );
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
    case 'changeKind':
      return withCables(action.id);
    case 'moveElement':
      return withCables(action.id);
    case 'removeElements':
    case 'moveElements':
      return action.ids.some(withCables);
    case 'rotateElements':
      return action.ids.some((id) => element(byId(id)));
    case 'pasteComponents':
      return (
        action.elements.some(element) ||
        action.cables.some(cable) ||
        (action.replaceIds ?? []).some(withCables)
      );
    case 'addCable':
      return cable(action.cable);
    case 'updateCable':
      return cable(cableById(action.id));
    case 'removeCables':
      return action.ids.some((id) => cable(cableById(id)));
    case 'loadImport':
      return action.changes.some((c) => element(byId(c.id)));
    case 'planUploaded':
      return [action.floorId, ...(action.alsoFloorIds ?? [])].some((f) =>
        DisciplineSchema.options.some((d) => isFlagged(floorFlags, f, d)),
      );
    case 'calibration':
      return DisciplineSchema.options.some((d) => isFlagged(floorFlags, action.floorId, d));
    default:
      return false;
  }
}
