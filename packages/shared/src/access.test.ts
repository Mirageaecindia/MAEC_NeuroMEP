import { describe, expect, it } from 'vitest';
import { canEditFloorPlans, editableDisciplines, outsideEditRights } from './access.js';
import { setRiser } from './model/riser.js';
import { modelledProject, sampleDb } from './testing.js';
import type { UserSummary } from './users.js';

const user = (id: string, role: UserSummary['role']): UserSummary => ({
  id,
  role,
  name: id,
  email: `${id}@neuromep.dev`,
});
const LEAD = user('u-lead', 'TECHNICAL_LEAD');
const ELEC = user('u-elec', 'ELECTRICAL_ENGINEER'); // assigned in the fixture
const ELEC2 = user('u-elec2', 'ELECTRICAL_ENGINEER'); // not assigned
const MECH = user('u-mech', 'MECHANICAL_ENGINEER');
const CHECKER = user('u-check', 'CHECKER');

describe('#TASK-10 discipline layers (Section 2)', () => {
  it('gives the Lead every layer and an assigned engineer their own', () => {
    const p = modelledProject();
    expect(editableDisciplines(LEAD, p)).toEqual(['electrical', 'mechanical', 'phe']);
    expect(editableDisciplines(ELEC, p)).toEqual(['electrical']);
    expect(editableDisciplines(ELEC2, p)).toEqual([]);
    expect(editableDisciplines(CHECKER, p)).toEqual([]);
    expect(canEditFloorPlans(ELEC, p)).toBe(true);
    expect(canEditFloorPlans(MECH, p)).toBe(false);
  });

  it('lets an engineer change components and plans of their layer only', () => {
    const before = modelledProject();
    const gf = before.building.floors.find((f) => f.code === 'GF')!;
    const added = structuredClone(before);
    added.model.elements.push(sampleDb(gf.id, 'db-2'));
    added.building.floors.find((f) => f.code === 'GF')!.plan = null;
    expect(outsideEditRights(ELEC, before, added)).toBeNull();

    const mechanical = structuredClone(before);
    mechanical.model.elements.push({ ...sampleDb(gf.id, 'ahu-1'), discipline: 'mechanical' });
    expect(outsideEditRights(ELEC, before, mechanical)).toBe('DB-ahu-1 (mechanical)');

    const moved = structuredClone(before);
    moved.model.elements[0] = { ...moved.model.elements[0]!, discipline: 'mechanical' };
    expect(outsideEditRights(ELEC, before, moved)).toMatch(/\(mechanical\)$/);
  });

  it('#TASK-17 keeps the Riser Design in the electrical layer', () => {
    const before = modelledProject();
    const riser = structuredClone(before);
    riser.model.risers = setRiser([], 'riser-1', { lengthM: 26, widthM: 0.4 });
    expect(outsideEditRights(ELEC, before, riser)).toBeNull();
    // A mechanical engineer assigned to the project may not change them.
    before.disciplines.mechanical = [MECH.id];
    riser.disciplines.mechanical = [MECH.id];
    expect(outsideEditRights(MECH, before, riser)).toBe('risers (electrical)');
  });

  it('refuses any change to Project Set-up, whatever the key order', () => {
    const before = modelledProject();
    const renamed = structuredClone(before);
    renamed.details.name = 'Other';
    expect(outsideEditRights(ELEC, before, renamed)).toBe('Project Set-up');
    const reordered = { ...structuredClone(before), details: { ...before.details } };
    expect(outsideEditRights(ELEC, before, reordered)).toBeNull();
    expect(outsideEditRights(CHECKER, before, before)).toBe('this project');
  });
});
