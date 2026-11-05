import { rulePackForRegion } from '@neuromep/rulepacks';
import { describe, expect, it } from 'vitest';
import { busbarChoices, busbarDropPct, distributionFactor } from './busbar.js';
import { checkNetworkFeeders } from './checks.js';
import { checkNetwork } from './duty.js';
import { building } from './fixtures/network.js';

const pack = rulePackForRegion('dubai')!;
const SINGLE = {
  cores: '1C' as const,
  armour: 'AWA' as const,
  groupedCircuits: 1,
  separation: 'touching',
};

describe('#TASK-21 busbar data (manager 3 Nov 2026, Busbar Data.xlsx)', () => {
  it('R at 95 deg C = R20 x (1 + 0.00393 x 75), as the sheet (Schneider 800 A: 0.0958115 mOhm/m)', () => {
    const s800 = busbarChoices(pack, 'schneider')[0]!;
    expect(s800).toMatchObject({
      ratingA: 800,
      r20MohmM: 0.074,
      xMohmM: 0.022,
      icwKa: 30,
      ipkKa: 63,
    });
    expect(s800.rHotMohmM).toBeCloseTo(0.0958115, 9);
  });

  it('voltage drop k x sqrt3 x (R95 cos + X sin) x Ib x L: the sheet value 0.1327 V at 800 A, 1 m, pf 0.9', () => {
    const s800 = busbarChoices(pack, 'schneider')[0]!;
    const pct = busbarDropPct(s800, 800, 0.9, 1);
    expect((pct / 100) * 400).toBeCloseTo(0.1327, 3); // sheet R15 (sin taken as 0.435 there)
  });

  it('load distribution factor k = (n + 1) / 2n for n tap-offs, 1 for one load', () => {
    expect(distributionFactor(1)).toBe(1);
    expect(distributionFactor(3)).toBeCloseTo(4 / 6, 12);
    expect(distributionFactor(10)).toBeCloseTo(11 / 20, 12);
  });
});

/** TX 2000 kVA > busbar feeder (20 m) > MDB > DB 600 kW, Schneider busbar data. */
function busbarFeeder(maker: 'schneider' | 'gersan' | null = 'schneider') {
  const b = building();
  b.project.calculation.busbarMaker = maker;
  b.add('transformer', 'tx', { kva: 2000, ukPct: 6, urPct: 1 });
  b.add('mdb', 'mdb');
  b.db('db', [200, 200, 200]);
  const bb = b.feed('tx', 'mdb', 20, SINGLE);
  bb.feederType = 'busbar';
  b.feed('mdb', 'db', 10, {
    cores: '1C',
    armour: 'AWA',
    groupedCircuits: 1,
    separation: 'touching',
  });
  return b;
}

describe('#TASK-21 / #TASK-22 / #TASK-23 busbar feeders', () => {
  it('asks for the busbar manufacturer before sizing a busbar feeder', () => {
    const f = checkNetworkFeeders(busbarFeeder(null).project).feeders.find(
      (x) => x.toId === 'mdb',
    )!;
    expect(f).toMatchObject({ c1: 'blocked', status: 'blocked' });
    expect(f.trace.at(-1)?.detail).toBe('Choose the busbar manufacturer on Import File.');
  });

  it('takes the smallest rating >= In and works out its voltage drop by hand', () => {
    const f = checkNetworkFeeders(busbarFeeder().project).feeders.find((x) => x.toId === 'mdb')!;
    // 600 kW at pf 0.85: Ib = 1018.9 A, In 1250 A -> Schneider 1250 A.
    expect(f.device?.ratingA).toBe(1250);
    expect(f.busbar).toMatchObject({ ratingA: 1250, maker: 'schneider' });
    expect(f.c1).toBe('pass');
    const r95 = 0.042 * (1 + 0.00393 * 75);
    const vu = Math.sqrt(3) * (r95 * 0.85 + 0.012 * Math.sin(Math.acos(0.85)));
    expect(f.drop!.vcPct).toBeCloseTo(((vu * f.ibA! * 20) / 1000 / 400) * 100, 9);
    expect(f.vdTotalPct).toBeCloseTo(f.drop!.vcPct, 9); // from the transformer
  });

  it('adds the busbar R20 / X to the fault path and checks its own withstand (C7)', () => {
    const all = checkNetwork(busbarFeeder().project);
    const main = all.find((x) => x.toId === 'mdb')!;
    const db = all.find((x) => x.toId === 'db')!;
    // Breaker of the DB feeder sits in the MDB, after 20 m of busbar.
    expect(db.faultAtBreaker!.ikMaxKa).toBeLessThan(main.faultAtBreaker!.ikMaxKa);
    expect(main.busbarWithstand?.state).toBe('pass'); // 1250 A: Icw 65 kA, Ipk 143 kA
    expect(main.busbarWithstand?.detail).toMatch(/Icw 65 kA vs/);
  });

  it('says when the maker gives no Icw / Ipk (Gersan)', () => {
    const main = checkNetwork(busbarFeeder('gersan').project).find((x) => x.toId === 'mdb')!;
    expect(main.busbarWithstand?.state).toBe('not-calculated');
  });
});

/** MDB > Riser 1 (30 m) > three SMDBs on tap-offs > a DB below one of them. */
function riserBuilding(maker: 'powerbar' | null = 'powerbar') {
  const b = building();
  b.project.calculation.busbarMaker = maker;
  b.add('transformer', 'tx', { kva: 2000, ukPct: 6, urPct: 1 });
  b.add('mdb', 'mdb');
  b.feed('tx', 'mdb', 10, SINGLE);
  for (const id of ['sm1', 'sm2', 'sm3']) b.add('smdb', id);
  b.db('db', [60, 60, 60]);
  b.feed('sm1', 'db', 20, SINGLE);
  b.db('db2', [100, 100, 100]);
  b.feed('sm2', 'db2', 20, SINGLE);
  b.db('db3', [100, 100, 100]);
  b.feed('sm3', 'db3', 20, SINGLE);
  b.project.model.risers = [
    { id: 'r1', lengthM: 30, widthM: 1, fedFromId: 'mdb', feeds: ['sm1', 'sm2', 'sm3'] },
  ];
  return b;
}

describe('#TASK-22 / #TASK-23 risers as busbars (k = (n + 1) / 2n)', () => {
  it('sizes the riser for the demand of its tap-offs and works out its drop with k', () => {
    const { risers, feeders } = checkNetworkFeeders(riserBuilding().project);
    const r = risers[0]!;
    // 780 kW balanced at pf 0.85: Ib = 1324.6 A, In 1600 A -> Powerbar 1600 A.
    expect(r.ibA).toBeCloseTo((780 * 1000) / (Math.sqrt(3) * 400 * 0.85), 6);
    expect(r.inA).toBe(1600);
    expect(r.busbar?.ratingA).toBe(1600);
    expect(r.k).toBeCloseTo(4 / 6, 12);
    const r95 = 0.033 * (1 + 0.00393 * 75);
    const vu = Math.sqrt(3) * (r95 * 0.85 + 0.013 * Math.sin(Math.acos(0.85)));
    const expected = ((r.k * vu * r.ibA! * 30) / 1000 / 400) * 100;
    expect(r.vdPct).toBeCloseTo(expected, 9);
    const main = feeders.find((f) => f.toId === 'mdb')!;
    expect(r.vdTotalPct).toBeCloseTo(main.vdTotalPct! + expected, 9);
    // The DB below SMDB-1 now starts from the riser's real drop, not the 2 % allowance (10.13).
    const db = feeders.find((f) => f.toId === 'db')!;
    expect(db.vdUpstreamPct).toBeCloseTo(r.vdTotalPct!, 9);
  });

  it('without a busbar maker the riser is not calculated and the allowance rule stays', () => {
    const { risers, feeders } = checkNetworkFeeders(riserBuilding(null).project);
    expect(risers[0]!.busbar).toBeNull();
    expect(risers[0]!.notes.join(' ')).toMatch(
      /No busbar manufacturer chosen: choose it on Import File/,
    );
    expect(feeders.find((f) => f.toId === 'db')!.vdUpstreamPct).toBe(2);
  });

  it('adds the riser impedance to the fault level below it, and gives a minimum again', () => {
    const all = checkNetwork(riserBuilding().project);
    const atMdb = all.find((x) => x.toId === 'mdb')!; // breaker at the transformer
    const db = all.find((x) => x.toId === 'db')!; // breaker in SMDB-1, below the riser
    expect(db.faultAtBreaker!.ikMaxKa).toBeLessThan(atMdb.faultAtBreaker!.ikMaxKa);
    expect(db.ikMinFarKa).not.toBeNull();
  });
});

describe('#TASK-22 riser and busbar edge cases', () => {
  it('unbalanced tap-off loads: the largest phase current on 230 V', () => {
    const b = riserBuilding();
    const db = b.project.model.elements.find((e) => e.id === 'db') as Extract<
      (typeof b.project.model.elements)[number],
      { kind: 'db' }
    >;
    db.loads = [{ method: 'kw', loadType: '2', kwL1: 90, kwL2: 60, kwL3: 30 }];
    const r = checkNetworkFeeders(b.project).risers[0]!;
    // Phases 290 / 260 / 230 kW at pf 0.85.
    expect(r.ibA).toBeCloseTo((290 * 1000) / (230 * 0.85), 6);
  });

  it('a riser with no load, no length, or more current than any busbar says so', () => {
    const empty = riserBuilding();
    empty.project.model.risers[0]!.feeds = [];
    expect(checkNetworkFeeders(empty.project).risers[0]!.ibA).toBeNull();
    expect(checkNetworkFeeders(empty.project).risers[0]!.notes).toEqual([
      'Riser 1 feeds no boards: click a board on a floor to connect it to a tap-off of this riser.',
    ]);
    const noLoad = riserBuilding();
    for (const e of noLoad.project.model.elements) if (e.kind === 'db') e.loads = [];
    expect(checkNetworkFeeders(noLoad.project).risers[0]!.ibA).toBeNull();
    expect(checkNetworkFeeders(noLoad.project).risers[0]!.notes[0]).toMatch(
      /^No load reaches Riser 1: enter the loads of the DBs fed from /,
    );
    const noLength = riserBuilding();
    noLength.project.model.risers[0]!.lengthM = null;
    expect(checkNetworkFeeders(noLength.project).risers[0]!.notes).toEqual([
      'Riser 1 has no length: enter it in Riser Design.',
    ]);
    // Everything missing at once is listed together, not one reason at a time.
    const bare = riserBuilding();
    bare.project.calculation.busbarMaker = null;
    bare.project.model.risers[0] = {
      ...bare.project.model.risers[0]!,
      fedFromId: null,
      lengthM: null,
    };
    expect(checkNetworkFeeders(bare.project).risers[0]!.notes).toEqual([
      'Riser 1 has no source: click the riser in the diagram to choose the transformer, LV panel or MDB that feeds it.',
      'Riser 1 has no length: enter it in Riser Design.',
      'No busbar manufacturer chosen: choose it on Import File (Busbar Manufacturer).',
    ]);
    const huge = riserBuilding();
    for (const e of huge.project.model.elements) {
      if (e.kind === 'db')
        e.loads = [{ method: 'kw', loadType: '2', kwL1: 900, kwL2: 900, kwL3: 900 }];
    }
    expect(checkNetworkFeeders(huge.project).risers[0]!.notes.join(' ')).toMatch(
      /No powerbar busbar rating at or above/,
    );
  });

  it('a busbar feeder above the largest rating of the maker is blocked (E2101)', () => {
    const b = busbarFeeder();
    const db = b.project.model.elements.find((e) => e.id === 'db') as Extract<
      (typeof b.project.model.elements)[number],
      { kind: 'db' }
    >;
    db.loads = [{ method: 'kw', loadType: '2', kwL1: 700, kwL2: 700, kwL3: 700 }];
    const f = checkNetworkFeeders(b.project).feeders.find((x) => x.toId === 'mdb')!;
    expect(f).toMatchObject({ c1: 'blocked', status: 'blocked' });
    expect(f.errors).toContain('E2101');
  });
});
