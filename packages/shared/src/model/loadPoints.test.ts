import { describe, expect, it } from 'vitest';
import { completeProject, sampleDb, testCable, testElement } from '../testing.js';
import type { Element, LoadLine } from './elements.js';
import { fireRatedFlags, withSafetyDefaults } from './fireRated.js';
import { generatorAnalyses, setGeneratorFactor } from './generator.js';
import { loadSummaries } from './loads.js';

/** Mechanical equipment is shown by the isolator that feeds it (user decision 6 Nov 2026). */
const fan: LoadLine[] = [{ method: 'kw', loadType: '3', kwL1: 2.5, kwL2: 2.5, kwL3: 2.5 }];
const pump: LoadLine[] = [{ method: 'kw', loadType: '9', kwL1: 5, kwL2: 5, kwL3: 5 }];
const iso = (id: string, patch: Record<string, unknown> = {}) =>
  ({ ...testElement('isolator-tp', id), tag: id.toUpperCase(), ...patch }) as Element;

describe('#TASK-15 #TASK-27 isolators and connection units as equipment', () => {
  it('places with load category Normal (Normal / Essential / Critical / FLS), not fire rated', () => {
    const e = iso('iso');
    expect(e).toMatchObject({
      kind: 'isolator',
      poles: 'TP',
      loadCategory: 'normal',
      fireRated: false,
    });
    expect(testElement('connection-unit', 'fcu')).toMatchObject({
      kind: 'connection-unit',
      poles: 'SP',
    });
  });

  it('turns fire rated when set to FLS (components sheet); a value the edit sets wins', () => {
    expect(withSafetyDefaults(iso('iso'), { loadCategory: 'fls' })).toEqual({
      loadCategory: 'fls',
      fireRated: true,
    });
    expect(withSafetyDefaults(iso('iso'), { loadCategory: 'fls', fireRated: false })).toEqual({
      loadCategory: 'fls',
      fireRated: false,
    });
    // Already FLS: unticking Fire rated stays unticked.
    expect(withSafetyDefaults(iso('iso', { loadCategory: 'fls' }), { fireRated: false })).toEqual({
      fireRated: false,
    });
  });

  it('a new Fire Pumps load makes it FLS (and fire rated); it stays editable after', () => {
    expect(withSafetyDefaults(iso('iso'), { manualLoads: pump })).toEqual({
      manualLoads: pump,
      loadCategory: 'fls',
      fireRated: true,
    });
    // The engineer set it back to Normal: editing the loads again does not undo that.
    const back = iso('iso', { manualLoads: pump, loadCategory: 'normal' });
    expect(withSafetyDefaults(back, { manualLoads: [...pump, ...fan] })).toEqual({
      manualLoads: [...pump, ...fan],
    });
    // Boards keep their own load category.
    const db = sampleDb('gf', 'db');
    expect(withSafetyDefaults(db, { loadCategory: 'fls' })).toEqual({ loadCategory: 'fls' });
  });

  it('an FLS isolator flags its feeders to the generator (E2701) and starts at fire 1.0', () => {
    const p = completeProject();
    const tx = testElement('transformer', 'tx');
    const gen = { ...testElement('generator', 'gen'), tag: 'GEN', kvaOverride: 100 } as Element;
    const ats = testElement('ats', 'ats');
    const smdb = { ...testElement('smdb', 'smdb'), tag: 'ESMDB' } as Element;
    const spf = iso('spf', {
      description: 'SPF-1 smoke extract fan',
      loadCategory: 'fls',
      manualLoads: fan,
    });
    const ahu = iso('ahu', { manualLoads: fan });
    p.model.elements = [tx, gen, ats, smdb, spf, ahu];
    p.model.cables = [
      testCable(tx, ats, 'normal'),
      testCable(gen, ats, 'standby'),
      testCable(ats, smdb),
      testCable(smdb, spf),
      testCable(smdb, ahu),
    ];
    expect(fireRatedFlags(p.model).map((f) => [f.code, f.cableId])).toEqual([
      ['E2701', 'c-gen-ats'],
      ['E2701', 'c-ats-smdb'],
      ['E2701', 'c-smdb-spf'],
    ]);
    const [g] = generatorAnalyses(p, loadSummaries(p, 0.85), { sparePct: 10, pf: 0.8 });
    const rows = g!.groups.flatMap((x) => x.rows);
    expect(rows.map((r) => [r.to, r.category, r.factors.fire, r.fireKw])).toEqual([
      ['SPF', 'fls', 1, 7.5],
      ['AHU', 'normal', 0, 0],
    ]);
    expect(g!.totals.fireKw).toBe(7.5);
    // Editing one case keeps the row's other starting factors (fire 0 for the AHU).
    const list = setGeneratorFactor([], 'ahu', { normal: 0.8 }, rows[1]!.factors);
    expect(list).toEqual([
      { elementId: 'ahu', normal: 0.8, powerFailure: 1, fire: 0, remarks: '' },
    ]);
  });
});
