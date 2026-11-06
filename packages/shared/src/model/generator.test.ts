import { describe, expect, it } from 'vitest';
import { completeProject, sampleDb, testCable, testElement } from '../testing.js';
import type { Element } from './elements.js';
import { generatorAnalyses } from './generator.js';
import { loadSummaries } from './loads.js';

const db = (id: string, kw: number): Element =>
  ({
    ...sampleDb('gf', id),
    tag: id.toUpperCase(),
    loads: [{ method: 'kw', loadType: '2', kwL1: kw, kwL2: kw, kwL3: kw }],
  }) as Element;
const el = (key: string, id: string, patch: Record<string, unknown> = {}) =>
  ({ ...testElement(key, id), tag: id.toUpperCase(), ...patch }) as Element;

/** GEN > ATS (TX on the normal input) > EMDB > ESMDB > two DBs; EMDB also feeds DB-C directly. */
function project() {
  const p = completeProject();
  const tx = el('transformer', 'tx');
  const gen = el('generator', 'gen', { kvaOverride: 1750 });
  const ats = el('ats', 'ats');
  const emdb = el('mdb', 'emdb', {
    manualLoads: [{ method: 'kw', loadType: '1', kwL1: 1, kwL2: 1, kwL3: 1 }],
  });
  const esmdb = el('smdb', 'esmdb');
  const [a, b, c] = [db('db-a', 5.5), db('db-b', 2.5), db('db-c', 2)];
  p.model.elements = [tx, gen, ats, emdb, esmdb, a, b, c];
  p.model.cables = [
    testCable(tx, ats, 'normal'),
    testCable(gen, ats, 'standby'),
    testCable(ats, emdb),
    testCable(emdb, c),
    testCable(emdb, esmdb),
    testCable(esmdb, a),
    testCable(esmdb, b),
  ];
  return p;
}
const analyse = (p: ReturnType<typeof project>) =>
  generatorAnalyses(p, loadSummaries(p, 0.85), { sparePct: 10, pf: 0.8 });

describe('#TASK-28 Generator Load Analysis (OI-11, briefing page 8)', () => {
  it('lists every load downstream of the generator, panel by panel, starting at 1.0', () => {
    const [g] = analyse(project());
    expect(g!.tag).toBe('GEN');
    expect(g!.groups.map((x) => [x.from, x.to, x.rows.map((r) => r.to)])).toEqual([
      ['ATS', 'EMDB', ['EMDB (own loads)', 'DB-C']],
      ['EMDB', 'ESMDB', ['DB-A', 'DB-B']],
    ]);
    const a = g!.groups[1]!.rows[0]!;
    expect(a).toMatchObject({
      from: 'ESMDB',
      kw: { L1: 5.5, L2: 5.5, L3: 5.5 },
      totalKw: 16.5,
      factors: { normal: 1, powerFailure: 1, fire: 1 },
      edited: false,
    });
    expect(g!.totals.connectedKw).toBeCloseTo(3 + 6 + 16.5 + 7.5, 9);
  });

  it("applies the engineer's factors and sizes the generator from the higher case", () => {
    const p = project();
    // As the briefing rows: 16.5 kW x 0.8 = 13.2; a pressurisation fan 7.5 kW at 0.6 / 0.6 / 1.0.
    p.model.generatorFactors = [
      { elementId: 'db-a', normal: 0.8, powerFailure: 0.8, fire: 0.8, remarks: '' },
      { elementId: 'db-b', normal: 0.6, powerFailure: 0.6, fire: 1, remarks: '1D+1S' },
      { elementId: 'db-c', normal: 0, powerFailure: 0, fire: 0, remarks: '' },
      { elementId: 'emdb', normal: 0, powerFailure: 0, fire: 0, remarks: '' },
    ];
    const [g] = analyse(p);
    const rows = g!.groups.flatMap((x) => x.rows);
    expect(rows.find((r) => r.elementId === 'db-a')!.normalKw).toBeCloseTo(13.2, 9);
    expect(rows.find((r) => r.elementId === 'db-b')).toMatchObject({
      powerFailureKw: 4.5,
      fireKw: 7.5,
      remarks: '1D+1S',
      edited: true,
    });
    expect(g!.totals.powerFailureKw).toBeCloseTo(17.7, 9);
    expect(g!.totals.fireKw).toBeCloseTo(20.7, 9);
    expect(g!.governing).toBe('fire');
    expect(g!.loadKw).toBeCloseTo(20.7, 9);
    expect(g!.spareKw).toBeCloseTo(2.07, 9);
    expect(g!.requiredKw).toBeCloseTo(22.77, 9);
    expect(g!.requiredKva).toBeCloseTo(28.4625, 9);
    expect(g!.adequate).toBe(true); // 1750 kVA selected
  });

  it('reproduces the briefing summary: 1177 kW -> 1295 kW -> 1619 kVA', () => {
    const p = project();
    const big = db('db-a', 1177.483 / 3);
    p.model.elements = p.model.elements.map((e) => (e.id === 'db-a' ? big : e));
    p.model.generatorFactors = ['db-b', 'db-c', 'emdb'].map((elementId) => ({
      elementId,
      normal: 0,
      powerFailure: 0,
      fire: 0,
      remarks: '',
    }));
    const [g] = analyse(p);
    expect(Math.round(g!.loadKw)).toBe(1177);
    expect(Math.round(g!.spareKw!)).toBe(118);
    expect(Math.round(g!.requiredKw!)).toBe(1295);
    expect(Math.round(g!.requiredKva!)).toBe(1619);
    expect(g!.adequate).toBe(true); // 1750 kVA selected
  });

  it("warns when the generator's kVA is below the required, and waits while not entered", () => {
    const p = project();
    p.model.elements = p.model.elements.map((e) =>
      e.id === 'gen' ? ({ ...e, kvaOverride: 20 } as Element) : e,
    );
    expect(analyse(p)[0]!.adequate).toBe(false);
    p.model.elements = p.model.elements.map((e) =>
      e.id === 'gen' ? ({ ...e, kvaOverride: null } as Element) : e,
    );
    expect(analyse(p)[0]).toMatchObject({ selectedKva: null, adequate: null });
    expect(
      generatorAnalyses(p, loadSummaries(p, 0.85), { sparePct: null, pf: 0.8 })[0],
    ).toMatchObject({ spareKw: null, requiredKva: null, adequate: null });
  });

  it('has no analysis without a generator', () => {
    const p = project();
    p.model.elements = p.model.elements.filter((e) => e.kind !== 'generator');
    expect(analyse(p)).toEqual([]);
  });
});
