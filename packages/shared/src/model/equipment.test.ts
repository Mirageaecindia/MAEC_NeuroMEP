import { describe, expect, it } from 'vitest';
import { completeProject, sampleDb, testCable, testElement } from '../testing.js';
import { capacitySummary } from './capacity.js';
import type { Element } from './elements.js';
import { fireRatedFlags, loadCategoryOf } from './fireRated.js';
import { flagBlockers } from './floorFlags.js';
import { generatorAnalyses } from './generator.js';
import { equipmentInputKw, loadSummaries } from './loads.js';
import { completenessIssues, unlinkedEquipment } from './network.js';

/** Mechanical / PHE equipment fed from an isolator (briefing page 9, 6 Nov 2026). */
const equip = (id: string, patch: Record<string, unknown> = {}) =>
  ({ ...testElement('mechanical-equipment', id), tag: id.toUpperCase(), ...patch }) as Element;
const iso = (id: string) =>
  ({ ...testElement('isolator-tp', id), tag: id.toUpperCase() }) as Element;

describe('#TASK-15 #TASK-18 mechanical / PHE equipment', () => {
  it('takes input kW = rated kW / efficiency; motor-driven needs it, others take 1.0', () => {
    const e = (patch: Record<string, unknown>) => equip('e', { kw: 8, ...patch }) as never;
    expect(equipmentInputKw(e({}))).toBe(8); // no starter: efficiency 1.0
    expect(equipmentInputKw(e({ efficiency: 0.8 }))).toBe(10);
    expect(equipmentInputKw(e({ starter: 'DOL' }))).toBeNull(); // E2003, never assumed
    expect(equipmentInputKw(e({ starter: 'VFD', efficiency: 0.9 }))).toBeCloseTo(8.888889, 5);
    expect(equipmentInputKw(e({ kw: null }))).toBe(0);
  });

  it('hands its load to the isolator it is fed from, with its own power factor and phase', () => {
    const p = completeProject();
    const smdb = testElement('smdb', 'smdb');
    const fan = equip('fan', { kw: 6, efficiency: 0.8, powerFactor: 0.9, fedFromId: 'iso' });
    const heater = equip('heater', { kw: 2, phases: 'L2', loadType: '4', fedFromId: 'iso' });
    p.model.elements = [smdb, iso('iso'), fan, heater];
    p.model.cables = [testCable(smdb, p.model.elements[1]!)];
    const s = loadSummaries(p, { defaultPf: 0.85, byType: { '4': 1 } });
    expect(s.get('iso')!.connected).toEqual({ L1: 2.5, L2: 4.5, L3: 2.5 }); // 7.5 / 3 + 2 on L2
    // Q = 7.5 x tan(acos 0.9); the heater at 1.0 adds none.
    const q = 7.5 * Math.tan(Math.acos(0.9));
    expect(s.get('iso')!.pf).toBeCloseTo(9.5 / Math.hypot(9.5, q), 12);
    expect(s.get('smdb')!.connectedKw).toBeCloseTo(9.5, 12);
    expect(s.get('iso')!.incomplete).toEqual([]);
  });

  it('reports motor-driven equipment without efficiency up the tree (E2003)', () => {
    const p = completeProject();
    const smdb = testElement('smdb', 'smdb');
    const pump = equip('pump', { kw: 5, starter: 'star-delta', fedFromId: 'iso' });
    p.model.elements = [smdb, iso('iso'), pump];
    p.model.cables = [testCable(smdb, p.model.elements[1]!)];
    const s = loadSummaries(p, 0.85);
    expect(s.get('iso')!.incomplete).toEqual(['PUMP']);
    expect(s.get('smdb')!.incomplete).toEqual(['PUMP']);
  });

  it('warns while equipment is not connected to a panel (E1803) and keeps the floor from flagging', () => {
    const p = completeProject();
    const gf = p.building.floors.find((f) => f.code === 'GF')!.id;
    const loose = { ...equip('ahu-1'), floorId: gf } as Element;
    const onDb = { ...equip('ahu-2', { fedFromId: 'db' }), floorId: gf } as Element;
    const ok = { ...equip('ahu-3', { fedFromId: 'iso' }), floorId: gf } as Element;
    p.model.elements = [{ ...sampleDb(gf, 'db') }, { ...iso('iso'), floorId: gf }, loose, onDb, ok];
    expect(unlinkedEquipment(p.model).map((e) => e.tag)).toEqual(['AHU-1', 'AHU-2']);
    const issues = completenessIssues(p.model, p.building.floors).filter((i) => i.code === 'E1803');
    expect(issues.map((i) => i.message)).toEqual([
      'AHU-1 is not connected to a panel: choose its isolator or connection unit in Fed from.',
      'AHU-2 is not connected to a panel: choose its isolator or connection unit in Fed from.',
    ]);
    // Equipment is never reported as E1801 itself: its isolator carries the supply check.
    expect(
      completenessIssues(p.model, p.building.floors).some(
        (i) => i.code === 'E1801' && i.elementId?.startsWith('ahu'),
      ),
    ).toBe(false);
    expect(flagBlockers(p.model, p.building.floors, gf, 'mechanical').map((i) => i.code)).toEqual([
      'E1803',
      'E1803',
    ]);
  });

  it('FLS equipment makes its isolator count as FLS: E2701 path and the fire column', () => {
    const p = completeProject();
    const tx = testElement('transformer', 'tx');
    const gen = { ...testElement('generator', 'gen'), kvaOverride: 100 } as Element;
    const ats = testElement('ats', 'ats');
    const smdb = testElement('smdb', 'smdb');
    const i = iso('iso');
    const spf = equip('spf-1', { kw: 3, fls: true, fedFromId: 'iso' });
    const ahu = equip('ahu-1', { kw: 6, fedFromId: 'iso' });
    p.model.elements = [tx, gen, ats, smdb, i, spf, ahu];
    p.model.cables = [
      testCable(tx, ats, 'normal'),
      testCable(gen, ats, 'standby'),
      testCable(ats, smdb),
      testCable(smdb, i),
    ];
    expect(loadCategoryOf(i, p.model.elements)).toBe('fls');
    expect(i).toMatchObject({ loadCategory: 'normal' }); // not stored on the electrical layer
    expect(fireRatedFlags(p.model).map((f) => f.cableId)).toEqual([
      'c-gen-ats',
      'c-ats-smdb',
      'c-smdb-iso',
    ]);
    const [g] = generatorAnalyses(p, loadSummaries(p, 0.85), { sparePct: 10, pf: 0.8 });
    expect(g!.groups.at(-1)!).toMatchObject({ from: 'smdb', to: 'ISO' });
    expect(g!.groups.at(-1)!.rows.map((r) => [r.to, r.category, r.fireKw])).toEqual([
      ['SPF-1', 'fls', 3],
      ['AHU-1', 'normal', 0],
    ]);
    // Counted once in the project load: through the isolator, not again on its own.
    const c = capacitySummary(p, loadSummaries(p, 0.85), { limitPct: 100, defaultPf: 0.85 });
    expect(c.demandKw).toBeCloseTo(9, 9);
  });
});
