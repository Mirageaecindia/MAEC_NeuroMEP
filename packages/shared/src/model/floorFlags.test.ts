import { describe, expect, it } from 'vitest';
import { lockedChange, outsideEditRights } from '../access.js';
import { modelledProject, testCable, testElement } from '../testing.js';
import { flagBlockers, floorStatus, setFloorFlag } from './floorFlags.js';
import { setBoardRiser, setRiser } from './riser.js';

const ELEC = { id: 'u-elec', role: 'ELECTRICAL_ENGINEER', name: 'Elec', email: 'e@x' } as const;
const by = { by: 'u-elec', at: '2026-10-30T08:00:00.000Z' };

/** modelledProject(): DB db-1 on the Ground Floor; returns it with the floor id. */
function project() {
  const p = modelledProject();
  return { p, gf: p.building.floors.find((f) => f.code === 'GF')!.id };
}

describe('#TASK-10 floor status and flags (A-08)', () => {
  it('is not opened, in progress once the discipline has work on it, then flagged', () => {
    const { p, gf } = project();
    expect(floorStatus(p.model, gf, 'mechanical')).toBe('not-opened');
    expect(floorStatus(p.model, gf, 'electrical')).toBe('in-progress');
    p.model.floorFlags = setFloorFlag([], gf, 'electrical', by);
    expect(floorStatus(p.model, gf, 'electrical')).toBe('flagged');
    expect(setFloorFlag(p.model.floorFlags, gf, 'electrical', null)).toEqual([]);
  });

  it('cannot be flagged while a component of the discipline has no source (E1801)', () => {
    const { p, gf } = project();
    expect(flagBlockers(p.model, p.building.floors, gf, 'electrical').map((i) => i.code)).toEqual([
      'E1801',
    ]);
    expect(flagBlockers(p.model, p.building.floors, gf, 'mechanical')).toEqual([]);
    // TX > riser 1 > DB: connected, the floor can be flagged.
    p.model.elements.push(testElement('transformer', 'tx', gf));
    p.model.risers = setBoardRiser(setRiser([], 'riser-1', { fedFromId: 'tx' }), 'db-1', 'riser-1');
    expect(flagBlockers(p.model, p.building.floors, gf, 'electrical')).toEqual([]);
  });

  it('locks the components, cables and plan of a flagged floor for everyone until reopened (E1003)', () => {
    const { p: before, gf } = project();
    before.model.floorFlags = setFloorFlag([], gf, 'electrical', by);
    const edited = structuredClone(before);
    edited.model.elements[0] = { ...edited.model.elements[0]!, description: 'Changed' };
    expect(lockedChange(before, edited)).toBe('DB-db-1 (Ground Floor)');
    const cabled = structuredClone(before);
    const tx = testElement('transformer', 'tx', gf);
    cabled.model.cables = [{ ...testCable(tx, before.model.elements[0]!), floorId: gf }];
    expect(lockedChange(before, cabled)).toMatch(/\(Ground Floor\)$/);
    const noPlan = structuredClone(before);
    noPlan.building.floors.find((f) => f.id === gf)!.plan = null;
    expect(lockedChange(before, noPlan)).toBe('Ground Floor plan');
    // Reopened in the same save: allowed.
    const reopened = { ...edited, model: { ...edited.model, floorFlags: [] } };
    expect(lockedChange(before, reopened)).toBeNull();
  });

  it('lets an engineer flag their own layer; only the Lead reopens', () => {
    const { p: before, gf } = project();
    const flagged = structuredClone(before);
    flagged.model.floorFlags = setFloorFlag([], gf, 'electrical', by);
    expect(outsideEditRights(ELEC, before, flagged)).toBeNull();
    const mech = structuredClone(before);
    mech.model.floorFlags = setFloorFlag([], gf, 'mechanical', by);
    expect(outsideEditRights(ELEC, before, mech)).toBe('floor flag (mechanical)');
    expect(outsideEditRights(ELEC, flagged, before)).toBe('floor flags (only the Lead reopens)');
  });
});
