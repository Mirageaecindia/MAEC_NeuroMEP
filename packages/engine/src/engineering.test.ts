import { rulePackForRegion } from '@neuromep/rulepacks';
import { describe, expect, it } from 'vitest';
import { cableSize, type SizedFeeder } from './cableSize.js';
import { makingFactor } from './duty.js';
import { building, randomBuilding, TRAY } from './fixtures/network.js';
import { tableValue } from './tables.js';

/**
 * WBS 1.6.7: the engine checked as an electrical engineer would check a design - against an
 * independent hand calculation (written here from the formulas of Section 10, using only raw table
 * values), and against the rules every correct design must satisfy, on a realistic building and on
 * many random ones.
 */

const SQRT3 = Math.sqrt(3);
const pack = rulePackForRegion('dubai')!;
const RATINGS = pack.devices.breakerRatingsA;
const raw = (fn: string, input: Record<string, string | number>) => {
  const v = tableValue(fn, input);
  if (!v.found) throw new Error(v.detail);
  return v.value;
};
const dewa = (inA: number) => {
  const rows = [...pack.devices.dewaMinimumCable.rows].sort((a, b) => a.breakerA - b.breakerA);
  return rows.find((r) => r.breakerA >= inA)!;
};

/**
 * A realistic small building: 1000 kVA transformer (uk 5 %, ur 1.2 %), 350 MVA upstream, 12 m of
 * 1C cable to the MDB; MDB > SMDB (35 m) > three DBs - office small power 20 kW balanced (30 m),
 * a 8 / 6 / 6 kW unbalanced DB (25 m) and a 30 kW DB at 70 m - all 4C Cu/XLPE/SWA on a tray.
 */
function officeBuilding() {
  const b = building();
  b.add('transformer', 'tx', { kva: 1000, ukPct: 5, urPct: 1.2 });
  b.add('mdb', 'mdb');
  b.add('smdb', 'sm');
  b.feed('tx', 'mdb', 12, {
    cores: '1C',
    armour: 'AWA',
    groupedCircuits: 1,
    separation: 'touching',
  });
  b.feed('mdb', 'sm', 35);
  b.db('db1', [20 / 3, 20 / 3, 20 / 3]);
  b.db('db2', [8, 6, 6]);
  b.db('db3', [10, 10, 10]);
  b.feed('sm', 'db1', 30);
  b.feed('sm', 'db2', 25);
  b.feed('sm', 'db3', 70);
  return b;
}

/** The rules every correct result must satisfy (Section 10). */
function assertEngineering(feeders: SizedFeeder[]) {
  const byTo = new Map(feeders.map((f) => [f.toId, f]));
  for (const f of feeders) {
    const where = `feeder ${f.cableId}`;
    // No NaN / Infinity anywhere in the numbers.
    for (const v of [
      f.ibA,
      f.rating?.izA,
      f.drop?.vcPct,
      f.vdTotalPct,
      f.faultAtBreaker?.ikMaxKa,
      f.faultAtBreaker?.ipKa,
      f.ikMinFarKa,
    ]) {
      if (v !== null && v !== undefined) expect(Number.isFinite(v), where).toBe(true);
    }
    if (!f.device || f.ibA === null) continue;
    // 10.5: In is the lowest standard rating >= Ib.
    expect(f.device.ratingA, where).toBeGreaterThanOrEqual(f.ibA);
    expect(RATINGS.includes(f.device.ratingA), where).toBe(true);
    expect(
      RATINGS.filter((r) => r >= f.ibA! && r < f.device!.ratingA),
      where,
    ).toEqual([]);
    if (!f.size || !f.rating) continue;
    // C1 consistent with its numbers; C6 for every unlocked size.
    expect(f.c1 === 'pass', where).toBe(f.rating.izA >= f.device.ratingA);
    const d = dewa(f.device.ratingA);
    expect(f.size.sizeMm2 * f.size.runs, where).toBeGreaterThanOrEqual(d.sizeMm2 * d.runs);
    // C2: the total is the drop up to the board plus this circuit, judged against the board's limit.
    if (f.vdTotalPct !== null && f.vdUpstreamPct !== null && f.drop) {
      expect(f.vdTotalPct, where).toBeCloseTo(f.vdUpstreamPct + f.drop.vcPct, 9);
      expect(f.c2 === 'pass', where).toBe(f.vdTotalPct <= f.vdLimitPct!);
    }
    // Fault levels fall going downstream; the minimum never exceeds the maximum.
    const up = byTo.get(sourceOf(f) ?? '');
    if (up?.faultAtBreaker && f.faultAtBreaker) {
      expect(f.faultAtBreaker.ikMaxKa, where).toBeLessThanOrEqual(up.faultAtBreaker.ikMaxKa + 1e-9);
    }
    if (f.ikMinFarKa !== null && f.faultAtBreaker) {
      expect(f.ikMinFarKa, where).toBeLessThanOrEqual(f.faultAtBreaker.ikMaxKa);
    }
    // C3: the chosen breaker covers Ik"max and its making capacity covers ip.
    if (f.duty && f.faultAtBreaker) {
      expect(f.duty.icuKa, where).toBeGreaterThanOrEqual(f.faultAtBreaker.ikMaxKa);
      expect(f.duty.icuKa * makingFactor(f.duty.icuKa), where).toBeGreaterThanOrEqual(
        f.faultAtBreaker.ipKa,
      );
    }
  }
}
/** The source board of a feeder (cable ids are c-<from>-<to> in the test builder). */
const sourceOf = (f: SizedFeeder) => /^c-(.+?)-(.+)$/.exec(f.cableId)?.[1];

describe('#TASK-26 engine against an independent hand calculation (office building)', () => {
  const b = officeBuilding();
  const out = cableSize(b.project);
  const f = (to: string) => out.feeders.find((x) => x.toId === to)!;

  it('converges and every result is Final (connected, factors confirmed, optional checks off)', () => {
    expect(out.converged).toBe(true);
    for (const x of out.feeders) expect(x.status, x.cableId).toBe('final');
  });

  it('design currents: Ib = P / (sqrt3 x 400 x pf) balanced, largest phase / (230 x pf) unbalanced', () => {
    expect(f('db1').ibA).toBeCloseTo((20 * 1000) / (SQRT3 * 400 * 0.85), 9);
    expect(f('db2').ibA).toBeCloseTo((8 * 1000) / (230 * 0.85), 9);
    expect(f('db3').ibA).toBeCloseTo((30 * 1000) / (SQRT3 * 400 * 0.85), 9);
    // SMDB: 20 + 20 + 30 kW = phases 21.67 / 19.67 / 18.67 kW; largest phase on 230 V.
    expect(f('sm').ibA).toBeCloseTo(((20 / 3 + 8 + 10) * 1000) / (230 * 0.85), 9);
    expect(f('db1').device!.ratingA).toBe(40);
    expect(f('db2').device!.ratingA).toBe(50);
    expect(f('db3').device!.ratingA).toBe(63);
  });

  it('current-carrying capacity: Iz = It x K1 x K2 from the raw Ducab / CableSizer tables', () => {
    const k1 = raw('TEMPDE', { METHOD: 'J', TYP: 'XLPE', TEMP: 50 });
    const k2 = raw('GROUPJ', { CORE: '4C', CIR: 6, SEP: 'D', no: 1 });
    for (const to of ['db1', 'db2', 'db3', 'sm']) {
      const x = f(to);
      const it = raw('NOMRATCU', {
        PHASE: 3,
        CORE: '4C',
        METHOD: 'J',
        INS: 'XLPE',
        size: x.size!.sizeMm2,
      });
      expect(x.rating!.izA, to).toBeCloseTo(it * k1 * k2 * x.size!.runs, 9);
    }
  });

  it('voltage drop: Vc = Ib x L x Vu / (1000 x runs), cumulative from the transformer', () => {
    const vu = (size: number) =>
      size < 25
        ? raw('VU', { CAB: size, TYP: 'XLPE', PHASES: 3 })
        : raw('RESIS', { CAB: size }) * 0.85 +
          raw('REACT', { CAB: size }) * Math.sin(Math.acos(0.85));
    const pct = (to: string, lengthM: number) => {
      const x = f(to);
      return ((x.ibA! * lengthM * vu(x.size!.sizeMm2)) / (1000 * x.size!.runs) / 400) * 100;
    };
    // The transformer cable is single-core: its r / x come from the multicore values (V-15 note).
    const smTotal = f('mdb').drop!.vcPct + pct('sm', 35);
    expect(f('sm').vdTotalPct).toBeCloseTo(smTotal, 9);
    expect(f('db1').vdTotalPct).toBeCloseTo(smTotal + pct('db1', 30), 9);
    expect(f('db3').vdTotalPct).toBeCloseTo(smTotal + pct('db3', 70), 9);
    expect(f('db3').vdTotalPct!).toBeLessThanOrEqual(2.5);
  });

  it('short circuit at the transformer, MDB and SMDB, recomputed by hand with the CableSizer method', () => {
    const vn2 = 400 * 400;
    // Upstream 350 MVA: Zup = Vn� / Sup, Xup = 0.995 Zup, Rup = 0.1 Xup.
    const zup = vn2 / (350 * 1000);
    const base = vn2 / 1000; // Vn� / S in mOhm for 1000 kVA
    const zt = 0.05 * base; // uk 5 %
    const rt = 0.012 * base; // ur 1.2 %
    let r = 0.1 * 0.995 * zup + rt;
    let x = 0.995 * zup + Math.sqrt(zt * zt - rt * rt);
    const ik = () => 400 / (SQRT3 * Math.hypot(r, x)); // c = 1
    expect(f('mdb').faultAtBreaker!.ikMaxKa).toBeCloseTo(ik(), 9); // breaker at the transformer
    // Cables: R = 18.32 x L / (A x N), X = 0.1 or 0.09 x L / N.
    const cable = (size: number, runs: number, lengthM: number) => {
      r += (18.32 * lengthM) / (size * runs);
      x += ((size < 120 ? 0.1 : 0.09) * lengthM) / runs;
    };
    const main = f('mdb').size!;
    cable(main.sizeMm2, main.runs, 12);
    expect(f('sm').faultAtBreaker!.ikMaxKa).toBeCloseTo(ik(), 9); // breaker in the MDB
    const sm = f('sm').size!;
    cable(sm.sizeMm2, sm.runs, 35);
    expect(f('db1').faultAtBreaker!.ikMaxKa).toBeCloseTo(ik(), 9); // breaker in the SMDB
    const kappa = 1.02 + 0.98 * Math.exp((-3 * r) / x);
    expect(f('db1').faultAtBreaker!.ipKa).toBeCloseTo(kappa * Math.SQRT2 * ik(), 9);
  });

  it('every size is the smallest that passes C1, C2 and C6 (no oversizing)', () => {
    for (const x of out.feeders) {
      if (x.size?.from !== 'sized') continue;
      expect(x.c1).toBe('pass');
      expect(x.c2).toBe('pass');
      // One standard size smaller (same runs) would fail C1, C2 or C6.
      const sizes = pack.devices.cableSizesMm2;
      const smaller = sizes[sizes.indexOf(x.size.sizeMm2) - 1];
      if (!smaller) continue;
      const d = dewa(x.device!.ratingA);
      const belowC6 = smaller * x.size.runs < d.sizeMm2 * d.runs;
      const it = raw('NOMRATCU', {
        PHASE: 3,
        CORE: TRAY.cores,
        METHOD: 'J',
        INS: 'XLPE',
        size: smaller,
      });
      const failsC1 = it * 0.82 * 0.9 * x.size.runs < x.device!.ratingA;
      const vu =
        smaller < 25
          ? raw('VU', { CAB: smaller, TYP: 'XLPE', PHASES: 3 })
          : raw('RESIS', { CAB: smaller }) * 0.85 +
            raw('REACT', { CAB: smaller }) * Math.sin(Math.acos(0.85));
      const failsC2 =
        x.vdUpstreamPct! + (x.ibA! * x.lengthM * vu) / (1000 * x.size.runs) / 4 > x.vdLimitPct!;
      expect(belowC6 || failsC1 || failsC2, x.cableId).toBe(true);
    }
  });

  it('satisfies every engineering rule', () => assertEngineering(out.feeders));
});

describe('#TASK-26 engineering rules on random buildings', () => {
  const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i);

  it.each(SEEDS)(
    'random building %i: converges, no NaN, Ib <= In <= Iz, C6, C2 totals, fault levels, C3',
    { timeout: 30_000 },
    (seed) => {
      const out = cableSize(randomBuilding(seed).project);
      expect(out.converged).toBe(true);
      assertEngineering(out.feeders);
    },
  );

  it('is repeatable: the same building gives the same sizes', { timeout: 60_000 }, () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const a = cableSize(randomBuilding(seed).project).feeders.map((f) => f.size);
      const b = cableSize(randomBuilding(seed).project).feeders.map((f) => f.size);
      expect(b).toEqual(a);
    }
  });

  it(
    'with at least the same current and upstream drop, more load or length never gives a smaller cable',
    { timeout: 120_000 },
    () => {
      const area = (f: SizedFeeder) => (f.size ? f.size.sizeMm2 * f.size.runs : 0);
      for (const seed of SEEDS.slice(0, 15)) {
        const base = cableSize(randomBuilding(seed).project).feeders;
        const heavier = randomBuilding(seed);
        for (const e of heavier.project.model.elements) {
          if (e.kind === 'db')
            e.loads = e.loads.map((l) =>
              l.method === 'kw'
                ? { ...l, kwL1: l.kwL1 * 1.5, kwL2: l.kwL2 * 1.5, kwL3: l.kwL3 * 1.5 }
                : l,
            );
        }
        const longer = randomBuilding(seed);
        for (const c of longer.project.model.cables)
          c.route = c.route.map((p) => ({ x: p.x * 2, y: p.y * 2 }));
        for (const variant of [heavier, longer]) {
          const after = cableSize(variant.project).feeders;
          for (const f of base) {
            const g = after.find((x) => x.cableId === f.cableId)!;
            // A larger cable above can lower the drop a cable inherits, so compare like with like.
            const comparable =
              f.size &&
              g.size &&
              [f.c1, f.c2, g.c1, g.c2].every((c) => c !== 'blocked') &&
              g.ibA! >= f.ibA! - 1e-9 &&
              (g.vdUpstreamPct ?? 0) >= (f.vdUpstreamPct ?? 0) - 1e-9 &&
              // C2 must be reachable at all: an upstream drop above the limit cannot be fixed here.
              (g.vdUpstreamPct ?? 0) < g.vdLimitPct!;
            if (comparable) {
              expect(area(g), `seed ${seed} ${f.cableId}`).toBeGreaterThanOrEqual(area(f));
            }
          }
        }
      }
    },
  );
});
