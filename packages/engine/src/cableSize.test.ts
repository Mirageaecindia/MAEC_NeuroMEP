import { describe, expect, it } from 'vitest';
import { cableSize } from './cableSize.js';
import { building } from './fixtures/network.js';

const SINGLE = {
  cores: '1C' as const,
  armour: 'AWA' as const,
  groupedCircuits: 1,
  separation: 'touching',
};

/**
 * TX (1000 kVA) and GEN (500 kVA) into an ATS feeding an ESMDB with an FLS pump DB and a critical
 * DB (no UPS); an essential DB hangs on the MDB, on the transformer only.
 */
function safetyBuilding() {
  const b = building();
  b.add('transformer', 'tx', { kva: 1000, ukPct: 5, urPct: 1.2 });
  b.add('generator', 'gen', { kvaOverride: 500, xdSubtransientPct: 14, sustainedScKa: 3 });
  b.add('mdb', 'mdb');
  b.add('ats', 'ats');
  b.add('esmdb', 'esmdb');
  b.feed('tx', 'mdb', 5, SINGLE);
  b.feed('mdb', 'ats', 10, {}, 'normal');
  b.feed('gen', 'ats', 10, {}, 'standby');
  b.feed('ats', 'esmdb', 10);
  b.db('fls', [5, 5, 5], { loadCategory: 'fls' });
  b.db('crit', [3, 3, 3], { loadCategory: 'critical' });
  b.db('ess', [3, 3, 3], { loadCategory: 'essential' });
  b.feed('esmdb', 'fls', 20);
  b.feed('esmdb', 'crit', 20);
  b.feed('mdb', 'ess', 20);
  return b;
}
const feederTo = (b: ReturnType<typeof building>, id: string) =>
  cableSize(b.project).feeders.find((f) => f.toId === id)!;

describe('#TASK-27 safety rules C8 / C9 (10.14)', () => {
  it('C8: an FLS load with a generator on its path passes', () => {
    expect(feederTo(safetyBuilding(), 'fls').c8.state).toBe('pass');
  });

  it('C8 / C9: an FLS isolator (mechanical equipment, 6 Nov 2026) needs the generator and FR cable', () => {
    const b = safetyBuilding();
    const fan = [{ method: 'kw', loadType: '3', kwL1: 2.5, kwL2: 2.5, kwL3: 2.5 }];
    b.add('isolator-tp', 'spf', {
      loadCategory: 'fls',
      description: 'SPF-1 smoke extract fan',
      manualLoads: fan,
    });
    b.add('isolator-tp', 'spf2', { loadCategory: 'fls', manualLoads: fan });
    b.feed('esmdb', 'spf', 15);
    b.feed('mdb', 'spf2', 15); // on the transformer only
    const out = cableSize(b.project).feeders;
    const spf = out.find((f) => f.toId === 'spf')!;
    expect(spf.c8.state).toBe('pass');
    expect(spf.c9.state).toBe('fail'); // its feeder is not fire-rated
    expect(spf.ibA).toBeGreaterThan(0);
    expect(out.find((f) => f.toId === 'spf2')!.c8).toMatchObject({
      state: 'fail',
      detail: expect.stringMatching(/no generator/),
    });
  });

  it('equipment on an isolator: Ib from rated kW / efficiency; no efficiency with a starter blocks (E2003)', () => {
    const b = safetyBuilding();
    b.add('isolator-tp', 'iso');
    b.feed('esmdb', 'iso', 15);
    b.add('mechanical-equipment', 'pump', {
      kw: 7.5,
      starter: 'DOL',
      powerFactor: 0.85,
      fedFromId: 'iso',
    });
    const blocked = feederTo(b, 'iso');
    expect(blocked).toMatchObject({ status: 'blocked', ibA: null });
    expect(blocked.errors).toContain('E2003');
    expect(blocked.trace.map((t) => t.detail).join(' ')).toMatch(/Efficiency missing on .*PUMP/);
    const pump = b.project.model.elements.find((e) => e.id === 'pump')!;
    Object.assign(pump, { efficiency: 0.9 });
    // 7.5 / 0.9 = 8.33 kW balanced at pf 0.85: Ib = 8333 / (sqrt3 x 400 x 0.85).
    expect(feederTo(b, 'iso').ibA).toBeCloseTo(8333.333 / (Math.sqrt(3) * 400 * 0.85), 2);
  });

  it('C8: a critical load needs a UPS as well as the generator', () => {
    const c8 = feederTo(safetyBuilding(), 'crit').c8;
    expect(c8.state).toBe('fail');
    expect(c8.detail).toMatch(/no UPS/);
  });

  it('C8: an essential load on the transformer only has no generator', () => {
    expect(feederTo(safetyBuilding(), 'ess').c8).toMatchObject({
      state: 'fail',
      detail: expect.stringMatching(/no generator/),
    });
  });

  it('C8: a critical load with a UPS and a generator upstream passes', () => {
    const b = safetyBuilding();
    b.add('ups', 'ups');
    b.project.model.cables = b.project.model.cables.filter((c) => c.to.elementId !== 'crit');
    b.feed('esmdb', 'ups', 5);
    b.feed('ups', 'crit', 10);
    expect(feederTo(b, 'crit').c8.state).toBe('pass');
  });

  it('C8 / C9 follow the supply through a riser: UPS above the riser, FLS below it', () => {
    const b = safetyBuilding();
    b.add('ups', 'ups');
    b.add('smdb', 'sm');
    b.project.model.cables = b.project.model.cables.filter(
      (c) => !['fls', 'crit'].includes(c.to.elementId),
    );
    b.feed('esmdb', 'ups', 5);
    b.project.model.risers = [{ id: 'r', lengthM: 20, widthM: 1, fedFromId: 'ups', feeds: ['sm'] }];
    b.feed('sm', 'crit', 10);
    b.feed('sm', 'fls', 10);
    const out = cableSize(b.project).feeders;
    expect(out.find((f) => f.toId === 'crit')!.c8.state).toBe('pass');
    // FLS below the riser: its feeder and the cables up to the generator are on the FLS path.
    expect(out.find((f) => f.toId === 'fls')!.c9.state).toBe('fail');
    expect(out.find((f) => f.cableId === 'c-gen-ats')!.c9.state).toBe('fail');
  });

  it('C8 is not required for normal loads', () => {
    const b = safetyBuilding();
    b.db('norm', [1, 1, 1]);
    b.feed('mdb', 'norm', 10);
    expect(feederTo(b, 'norm').c8.state).toBe('not-required');
  });

  it('C9: every cable from the FLS load to the generator is checked; XLPE warns', () => {
    const all = cableSize(safetyBuilding().project).feeders;
    const flagged = all
      .filter((f) => f.c9.state === 'fail')
      .map((f) => f.cableId)
      .sort();
    // FLS feeder, ATS > ESMDB, GEN > ATS (standby input) - not the transformer side (OI-32).
    expect(flagged).toEqual(['c-ats-esmdb', 'c-esmdb-fls', 'c-gen-ats']);
    expect(all.find((f) => f.cableId === 'c-mdb-ats')!.c9.state).toBe('not-required');
  });

  it('C9: a fire-rated busbar feeder on the path passes', () => {
    const b = safetyBuilding();
    const atsFeeder = b.project.model.cables.find((c) => c.id === 'c-ats-esmdb')!;
    atsFeeder.feederType = 'busbar';
    atsFeeder.busbar = { conductor: 'Cu', ipRating: null, fireRated: true };
    expect(feederTo(b, 'esmdb').c9.state).toBe('pass');
  });
});

describe('#TASK-26 result status (10.13)', () => {
  function simple() {
    const b = building();
    b.add('transformer', 'tx', { kva: 1000, ukPct: 5, urPct: 1.2 });
    b.add('mdb', 'mdb');
    b.db('db', [10, 10, 10]);
    b.feed('tx', 'mdb', 5, SINGLE);
    b.feed('mdb', 'db', 30);
    return b;
  }

  it('Final when connected, factors confirmed and every ticked check is complete', () => {
    const out = cableSize(simple().project);
    expect(out.converged).toBe(true);
    for (const f of out.feeders)
      expect(f).toMatchObject({ status: 'final', provisionalReasons: [] });
  });

  it('Provisional while a ticked check waits for breaker data (E2402)', () => {
    const b = simple();
    b.project.calculation.checks.letThroughEnergy = true;
    const f = feederTo(b, 'db');
    expect(f.status).toBe('provisional');
    expect(f.provisionalReasons).toContain('device-data-required');
  });

  it('Provisional with TBC demand factors (E1901)', () => {
    const b = simple();
    b.project.calculation.demandMethod = 'manual';
    b.project.calculation.demandFactors.byLoadType['2'] = { value: null, source: 'rulepack' };
    expect(feederTo(b, 'db').provisionalReasons).toContain('demand-factors-tbc');
  });

  it('Provisional without a path to a source; Blocked when data is missing', () => {
    const b = simple();
    b.project.model.cables = b.project.model.cables.filter((c) => c.id !== 'c-tx-mdb');
    expect(feederTo(b, 'db').provisionalReasons).toContain('upstream-not-connected');
    const m = simple();
    m.project.model.cables[1]!.construction.groupedCircuits = null;
    expect(feederTo(m, 'db').status).toBe('blocked');
  });

  it('explains when C2 cannot pass by sizing the cable (upstream drop above the limit)', () => {
    const b = simple();
    b.project.model.cables[0]!.route = [
      { x: 0, y: 0 },
      { x: 900, y: 0 },
    ]; // very long main cable
    b.project.model.cables[0]!.locks = { sizeMm2: 35, runs: 1, eccMm2: null };
    const f = feederTo(b, 'db');
    expect(f.c2).toBe('fail');
    expect(
      f.trace.some((t) => /C2 cannot pass by sizing this cable: the drop up to MDB/.test(t.detail)),
    ).toBe(true);
  });

  it('records Sized by in the result and trace', () => {
    const f = feederTo(simple(), 'db');
    expect(f.sizedBy).toBe('C6');
    expect(f.trace.at(-1)?.detail).toBe('Sized by C6.');
  });
});
