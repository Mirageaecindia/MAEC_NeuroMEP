import { describe, expect, it } from 'vitest';
import { completeProject, sampleDb, testCable, testElement } from '../testing.js';
import { capacitySummary } from './capacity.js';
import type { Element } from './elements.js';
import { loadSummaries } from './loads.js';

/** A DB with `kw` per phase at pf 0.8 (manual method: factors 1 for a clean figure). */
const db = (id: string, kw: number): Element =>
  ({
    ...sampleDb('gf', id),
    powerFactor: 0.8,
    loads: [{ method: 'kw', loadType: '2', kwL1: kw, kwL2: kw, kwL3: kw }],
  }) as Element;
const tx = (id: string, kva: number | null): Element =>
  ({ ...testElement('transformer', id), tag: id.toUpperCase(), kva }) as Element;

function setUp(build: (p: ReturnType<typeof completeProject>) => void, limitPct = 100) {
  const p = completeProject();
  p.calculation.demandMethod = 'manual';
  for (const f of Object.values(p.calculation.demandFactors.byLoadType)) f.value = 1;
  build(p);
  return capacitySummary(p, loadSummaries(p, 0.85), { limitPct, defaultPf: 0.85 });
}

describe('#TASK-28 transformer loading and plot allocation (10.15, briefing page 9)', () => {
  it('adds the load of every transformer, checks each against its rating x the limit', () => {
    const c = setUp((p) => {
      const t1 = tx('tx1', 1000);
      const t2 = tx('tx2', 500);
      const a = db('a', 200); // 600 kW / 0.8 = 750 kVA
      const b = db('b', 160); // 480 kW / 0.8 = 600 kVA
      p.model.elements = [t1, t2, a, b];
      p.model.cables = [testCable(t1, a), testCable(t2, b)];
      p.details.plotLoad = { value: 1200, unit: 'kVA' };
    }, 80);
    expect(c.demandKva).toBeCloseTo(1350, 9);
    expect(c.allowableKva).toBeCloseTo(1200, 9); // 1500 kVA x 80 %
    expect(c.loadedPct).toBeCloseTo(90, 9);
    expect(c.transformers.map((t) => [t.tag, Math.round(t.loadedPct!), t.over])).toEqual([
      ['TX1', 75, false], // 750 kVA <= 800
      ['TX2', 120, true], // 600 kVA > 400
    ]);
    expect(c.plot).toEqual({ allocation: 1200, unit: 'kVA', demand: c.demandKva, over: true });
  });

  it('counts a load fed through an ATS once, and a riser tap-off board under its source', () => {
    const c = setUp((p) => {
      const t = tx('tx', 1000);
      const gen = testElement('generator', 'gen');
      const ats = testElement('ats', 'ats');
      const a = db('a', 40);
      const b = db('b', 20);
      p.model.elements = [t, gen, ats, a, b];
      p.model.cables = [
        testCable(t, ats, 'normal'),
        testCable(gen, ats, 'standby'),
        testCable(ats, a),
      ];
      p.model.risers = [{ id: 'r1', lengthM: 10, widthM: 1, fedFromId: 'tx', feeds: ['b'] }];
      p.details.plotLoad = { value: 200, unit: 'kW' };
    });
    expect(c.demandKw).toBeCloseTo(180, 9); // 120 + 60 kW, not 300
    expect(c.transformers[0]!.demandKva).toBeCloseTo(225, 9);
    expect(c.plot!.over).toBe(false); // compared in kW
  });

  it('uses the plot allocation as allowable until a transformer is placed', () => {
    const c = setUp((p) => {
      p.model.elements = [db('a', 10)];
      p.details.plotLoad = { value: 85, unit: 'kW' };
    });
    expect(c.allowableKva).toBeCloseTo(100, 9); // 85 kW / 0.85
    expect(c.transformers).toEqual([]);
    // The DB has no supply yet: shown apart, not loaded (manager feedback, 7 Nov 2026).
    expect(c.loadedPct).toBe(0);
    expect(c.notConnected.count).toBe(1);
    expect(c.notConnected.kva).toBeCloseTo(37.5, 9);
  });

  it('skips the check of a transformer without a rating', () => {
    const c = setUp((p) => {
      p.model.elements = [tx('tx', null)];
    });
    expect(c.transformers[0]).toMatchObject({ ratingKva: null, over: false, loadedPct: null });
    expect(c.allowableKva).toBe(2500); // the plot allocation of completeProject()
  });
});
