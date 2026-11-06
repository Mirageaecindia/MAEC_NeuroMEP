import { z } from 'zod';
import type { Floor } from '../project/schema.js';
import type { Cable } from './cable.js';
import { DisciplineSchema, type Discipline, type Element } from './elements.js';
import { completenessIssues, type NetworkIssue } from './network.js';
import type { Riser } from './riser.js';

/**
 * Floor status per discipline (A-08): the engineer flags a floor when it is done; a flagged floor
 * is saved and locked for that discipline (E1003) until the Technical Lead reopens it.
 */
export const FloorFlagSchema = z.object({
  floorId: z.string().min(1),
  discipline: DisciplineSchema,
  by: z.string().min(1),
  at: z.string(),
});
export type FloorFlag = z.infer<typeof FloorFlagSchema>;

/** flagged = done and locked; in progress = work started (components of the discipline on it). */
export type FloorStatus = 'flagged' | 'in-progress' | 'not-opened';

interface Network {
  elements: readonly Element[];
  cables: readonly Cable[];
  risers: readonly Riser[];
  floorFlags: readonly FloorFlag[];
}

export const isFlagged = (
  flags: readonly FloorFlag[],
  floorId: string,
  discipline: Discipline,
): boolean => flags.some((f) => f.floorId === floorId && f.discipline === discipline);

export function floorStatus(m: Network, floorId: string, discipline: Discipline): FloorStatus {
  if (isFlagged(m.floorFlags, floorId, discipline)) return 'flagged';
  const started =
    m.elements.some((e) => e.floorId === floorId && e.discipline === discipline) ||
    (discipline === 'electrical' && m.cables.some((c) => c.floorId === floorId));
  return started ? 'in-progress' : 'not-opened';
}

/**
 * What stops a floor from being flagged done (Page 2 exit criteria: no unconnected components):
 * components of the discipline on the floor without a path to a source (E1801).
 */
export function flagBlockers(
  m: Network,
  floors: readonly Floor[],
  floorId: string,
  discipline: Discipline,
): NetworkIssue[] {
  const ofDiscipline = new Set(
    m.elements.filter((e) => e.discipline === discipline).map((e) => e.id),
  );
  return completenessIssues(m, floors).filter(
    (i) =>
      (i.code === 'E1801' || i.code === 'E1803') &&
      i.floorId === floorId &&
      ofDiscipline.has(i.elementId!),
  );
}

/** Flags `floorId` done for `discipline`, or reopens it (`flag` null). */
export function setFloorFlag(
  flags: readonly FloorFlag[],
  floorId: string,
  discipline: Discipline,
  flag: Pick<FloorFlag, 'by' | 'at'> | null,
): FloorFlag[] {
  const rest = flags.filter((f) => !(f.floorId === floorId && f.discipline === discipline));
  return flag ? [...rest, { floorId, discipline, ...flag }] : rest;
}
