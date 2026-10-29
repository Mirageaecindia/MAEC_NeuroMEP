import { setFloorFlag, type UserSummary } from '@neuromep/shared';
import { modelledProject, sampleDb } from '@neuromep/shared/testing';
import { describe, expect, it } from 'vitest';
import { touchesLockedFloor } from './floorLock';
import { mayApply } from './useProjectEditor';

const LEAD: UserSummary = { id: 'u-lead', role: 'TECHNICAL_LEAD', name: 'Lead', email: 'l@x' };
const ELEC: UserSummary = { id: 'u-elec', role: 'ELECTRICAL_ENGINEER', name: 'E', email: 'e@x' };

/** modelledProject() with its Ground Floor flagged done for electrical. */
function flagged() {
  const p = modelledProject();
  const gf = p.building.floors.find((f) => f.code === 'GF')!.id;
  p.model.floorFlags = setFloorFlag([], gf, 'electrical', { by: 'u-elec', at: 'now' });
  return { p, gf };
}

describe('#TASK-10 floor locks (A-08, E1003)', () => {
  it('locks the flagged layer and the plan of the floor, nothing else', () => {
    const { p, gf } = flagged();
    const patch = { description: 'x' };
    expect(touchesLockedFloor(p, { type: 'updateElement', id: 'db-1', patch })).toBe(true);
    expect(touchesLockedFloor(p, { type: 'removeElements', ids: ['db-1'] })).toBe(true);
    expect(touchesLockedFloor(p, { type: 'calibration', floorId: gf, calibration: null })).toBe(
      true,
    );
    const mech = { ...sampleDb(gf, 'ahu-1'), discipline: 'mechanical' as const };
    expect(touchesLockedFloor(p, { type: 'placeElement', element: mech })).toBe(false);
    const other = p.building.floors.find((f) => f.code === '1')!.id;
    expect(touchesLockedFloor(p, { type: 'placeElement', element: sampleDb(other, 'db-9') })).toBe(
      false,
    );
  });

  it('applies to the Lead too; an engineer flags but does not reopen', () => {
    const { p, gf } = flagged();
    const edit = { type: 'updateElement', id: 'db-1', patch: { description: 'x' } } as const;
    expect(mayApply(LEAD, p, edit)).toBe(false);
    const reopen = {
      type: 'floorFlag',
      floorId: gf,
      discipline: 'electrical',
      flag: null,
    } as const;
    expect(mayApply(ELEC, p, reopen)).toBe(false);
    expect(mayApply(LEAD, p, reopen)).toBe(true);
    const flag = {
      ...reopen,
      discipline: 'mechanical',
      flag: { by: 'u-elec', at: 'now' },
    } as const;
    expect(mayApply(ELEC, p, flag)).toBe(false);
  });
});
