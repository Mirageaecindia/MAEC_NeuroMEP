import {
  calculationSheet,
  ElementResultSchema,
  inputsKey,
  loadSummaries,
  mergeRun,
} from '@neuromep/shared';
import { describe, expect, it } from 'vitest';
import { cableSize } from './cableSize.js';
import { building } from './fixtures/network.js';
import { elementResults, riserCosts } from './results.js';

const SINGLE = { cores: '1C' as const, armour: 'AWA' as const, groupedCircuits: 1 };

/** TX > MDB > DB 30 kW, all on trays. */
function small() {
  const b = building();
  b.add('transformer', 'tx', { kva: 1000, ukPct: 6, urPct: 1 });
  b.add('mdb', 'mdb');
  b.feed('tx', 'mdb', 10, { ...SINGLE, separation: 'touching' });
  b.db('db', [10, 10, 10]);
  b.feed('mdb', 'db', 30, { groupedCircuits: 1 });
  return b;
}

describe('#TASK-26 / #TASK-27 Cable Size results as stored (WBS 1.7.1)', () => {
  it('gives every feeder and the component it feeds a valid result with the engine figures', () => {
    const { project } = small();
    const out = cableSize(project);
    const results = elementResults(project, out);
    for (const r of results) expect(ElementResultSchema.safeParse(r).success).toBe(true);
    const feeder = out.feeders.find((f) => f.toId === 'db')!;
    const cable = results.find((r) => r.elementId === feeder.cableId)!;
    const db = results.find((r) => r.elementId === 'db')!;
    expect(cable).toMatchObject({
      status: feeder.status,
      sizedBy: feeder.sizedBy,
      size: { runs: feeder.size!.runs, sizeMm2: feeder.size!.sizeMm2, cores: '4C' },
      device: { ratingA: feeder.device!.ratingA },
      values: { ibA: feeder.ibA, izA: feeder.rating!.izA, vdTotalPct: feeder.vdTotalPct },
      checks: { C1: { state: 'pass' }, C2: { state: 'pass' } },
    });
    expect(cable.load?.maxDemandKw).toBeCloseTo(30, 9);
    expect({ ...db, elementId: cable.elementId }).toEqual(cable);
    // The transformer has no incoming feeder and no result.
    expect(results.some((r) => r.elementId === 'tx')).toBe(false);
  });

  it('shows checks not ticked on Page 1 as not selected (D-08), breaker data as required', () => {
    const b = small();
    b.project.calculation.checks = {
      ...b.project.calculation.checks,
      shortCircuit: false,
      letThroughEnergy: true,
    };
    const r = elementResults(b.project, cableSize(b.project)).find((x) => x.elementId === 'db')!;
    expect(r.checks.C3).toEqual({
      state: 'not-calculated',
      detail: 'Not calculated - not selected on Page 1',
    });
    expect(r.checks.C5?.detail).toBe('Not calculated - not selected on Page 1');
    expect(r.checks.C4?.detail).toMatch(/^Device data required \(E2402\)/);
  });
});

describe('#TASK-27 stored results of special feeders (WBS 1.7.1)', () => {
  /** TX and GEN into an ATS feeding an FLS DB on XLPE cable; an empty DB on the MDB. */
  function standby() {
    const b = building();
    b.add('transformer', 'tx', { kva: 1000, ukPct: 5, urPct: 1.2 });
    b.add('generator', 'gen', { kvaOverride: 500, xdSubtransientPct: 14, sustainedScKa: 3 });
    b.add('mdb', 'mdb');
    b.add('ats', 'ats');
    b.feed('tx', 'mdb', 5, { ...SINGLE, separation: 'touching' });
    b.feed('mdb', 'ats', 10, {}, 'normal');
    b.feed('gen', 'ats', 10, {}, 'standby');
    b.db('fls', [5, 5, 5], { loadCategory: 'fls' });
    b.feed('ats', 'fls', 20);
    b.db('empty', [0, 0, 0]);
    b.feed('mdb', 'empty', 20);
    return b;
  }

  it('an ATS shows its normal input; C9 on an FLS path is a warning, not a failure', () => {
    const { project } = standby();
    const results = elementResults(project, cableSize(project));
    expect(results.find((r) => r.elementId === 'ats')).toMatchObject({
      ...results.find((r) => r.elementId === 'c-mdb-ats'),
      elementId: 'ats',
    });
    const fls = results.find((r) => r.elementId === 'c-ats-fls')!;
    expect(fls.checks.C9).toMatchObject({ state: 'warning' });
    expect(fls.checks.C8).toMatchObject({ state: 'pass' });
  });

  it('a feeder waiting for its load has no size, breaker or figures', () => {
    const { project } = standby();
    const r = elementResults(project, cableSize(project)).find((x) => x.elementId === 'empty')!;
    expect(r).toMatchObject({ status: 'awaiting-load', size: null, device: null });
    expect(r.checks.C1).toEqual({ state: 'not-calculated', detail: 'No size.' });
    expect(r.values).toMatchObject({ inA: null, izA: null, vdOwnPct: null });
    // The fault level where its breaker sits (the MDB) is known before the load.
    expect(r.values.ikMaxKa).toBeGreaterThan(0);
  });

  it('a busbar feeder gives its busbar rating as Iz and no cable size', () => {
    const b = small();
    b.project.calculation.busbarMaker = 'schneider';
    b.project.model.cables.find((c) => c.id === 'c-tx-mdb')!.feederType = 'busbar';
    const r = elementResults(b.project, cableSize(b.project)).find((x) => x.elementId === 'mdb')!;
    expect(r.size).toBeNull();
    expect(r.values.izA).toBe(800);
    expect(r.checks.C7?.detail).toMatch(/^800 A busbar: Icw 30 kA/);
  });
});

describe('Building tab Cost: busbar rating x 2.2 AED per riser (manager 3 Nov 2026)', () => {
  function withRiser() {
    const b = small();
    b.project.calculation.busbarMaker = 'schneider';
    b.add('smdb', 'sm');
    b.db('db2', [100, 100, 100]);
    b.feed('sm', 'db2', 10, { ...SINGLE, separation: 'touching' });
    b.project.model.risers = [
      { id: 'r1', lengthM: 30, widthM: 1, fedFromId: 'mdb', feeds: ['sm'] },
    ];
    return b;
  }

  it('prices each riser at its busbar rating x 2.2, whatever its length', () => {
    const { project } = withRiser();
    const cost = riserCosts(project, cableSize(project).risers);
    // 300 kW at pf 0.85: Ib 509 A, In 630 A -> the smallest Schneider busbar, 800 A.
    expect(cost.risers).toEqual([
      expect.objectContaining({ index: 1, ratingA: 800, costAed: 1760 }),
    ]);
    expect(cost.totalAed).toBe(1760);
    project.model.risers[0]!.lengthM = 45;
    expect(riserCosts(project, cableSize(project).risers).totalAed).toBe(1760);
    // Longer, the riser moves up a rating for its voltage drop (C2), and so does its price.
    project.model.risers[0]!.lengthM = 90;
    expect(riserCosts(project, cableSize(project).risers).risers[0]).toMatchObject({
      ratingA: 1000,
      costAed: 2200,
    });
  });

  it('gives the riser and each board on its tap-offs a result (Section 14 busbar schedule)', () => {
    const { project } = withRiser();
    const results = elementResults(project, cableSize(project));
    const riser = results.find((r) => r.elementId === 'r1')!;
    expect(riser).toMatchObject({ status: 'final', values: { inA: 630, izA: 800 } });
    expect(riser.checks.C2?.state).toBe('pass');
    // SMDB on the tap-off: 300 kW at pf 0.85 -> Ib 509.4 A, tap-off breaker 630 A MCCB.
    const sm = results.find((r) => r.elementId === 'sm')!;
    expect(sm.device).toEqual({ type: 'MCCB', ratingA: 630, poles: '3P', faultRatingKa: null });
    expect(sm.values.ibA).toBeCloseTo(300_000 / (Math.sqrt(3) * 400 * 0.85), 6);
    expect(sm.values.vdTotalPct).toBe(riser.values.vdTotalPct);
    for (const r of results) expect(ElementResultSchema.safeParse(r).success).toBe(true);
  });

  it('without a busbar maker the riser and its loaded tap-offs are blocked; empty ones wait', () => {
    const b = withRiser();
    b.project.calculation.busbarMaker = null;
    b.add('db', 'idle');
    b.db('spn', [4, 0, 0], { poles: 'SPN' });
    b.project.model.risers[0]!.feeds.push('idle', 'spn');
    const results = elementResults(b.project, cableSize(b.project));
    const of = (id: string) => results.find((r) => r.elementId === id)!;
    expect(of('r1')).toMatchObject({ status: 'blocked', errors: ['E2102'] });
    expect(of('r1').checks.C1?.detail).toMatch(/Choose the busbar manufacturer/);
    expect(of('sm')).toMatchObject({ status: 'blocked', errors: ['E2102'] });
    expect(of('idle')).toMatchObject({ status: 'awaiting-load', device: null, errors: [] });
    expect(of('spn').device).toMatchObject({ poles: '1P', type: 'MCB' });
  });

  it('has no total while a riser has no busbar rating (no maker chosen)', () => {
    const { project } = withRiser();
    project.calculation.busbarMaker = null;
    const cost = riserCosts(project, cableSize(project).risers);
    expect(cost.totalAed).toBeNull();
    expect(cost.risers[0]!.detail).toMatch(/Choose the busbar manufacturer/);
  });

  it('uses the Technical Lead override of the rate', () => {
    const { project } = withRiser();
    project.calculation.defaultOverrides = {
      ...project.calculation.defaultOverrides,
      riserCostAedPerA: 3,
    };
    expect(riserCosts(project, cableSize(project).risers).totalAed).toBe(2400);
  });
});

describe('#TASK-31 calculation sheet from a real run (WBS 1.7.3)', () => {
  it('rows agree with the engine: Iz = It x Ktot x runs, V and % drop, total = upstream + own', () => {
    const b = small();
    b.project.calculation.busbarMaker = 'schneider';
    b.add('smdb', 'sm');
    b.db('db2', [100, 100, 100]);
    b.feed('sm', 'db2', 10, { ...SINGLE, separation: 'touching' });
    b.project.model.risers = [
      { id: 'r1', lengthM: 30, widthM: 1, fedFromId: 'mdb', feeds: ['sm'] },
    ];
    const p = b.project;
    const run = { runId: 'r', at: '2026-11-05T08:00:00Z', engineVersion: 't' };
    p.model.results = mergeRun(p, { kind: 'project' }, elementResults(p, cableSize(p)), {
      ...run,
      inputsKey: inputsKey(p),
    });
    const sheet = calculationSheet(p, loadSummaries(p, 0.85));
    expect(sheet.sizesPending).toBe(false);
    expect(sheet.rows.map((r) => r.kind)).toEqual(['Cable', 'Cable', 'Riser', 'Cable']);
    for (const r of sheet.rows.filter((x) => x.kind === 'Cable')) {
      const n = (k: string) => r[k] as number;
      expect(n('izA')).toBeCloseTo(n('itA') * n('ktot') * n('runs'), 6);
      expect(n('vdOwnPct')).toBeCloseTo((n('vdOwnV') / n('voltageV')) * 100, 6);
      expect(n('vdTotalPct')).toBeCloseTo(n('vdUpstreamPct') + n('vdOwnPct'), 9);
      expect(r.C1).toBe('Pass');
    }
    const riser = sheet.rows.find((r) => r.kind === 'Riser')!;
    // One tap-off: k = (1 + 1) / 2 = 1; 800 A Schneider busbar for In 630 A.
    expect(riser).toMatchObject({ from: 'MDB', to: 'SM', busbarA: 800, loadFactorK: 1 });
    expect(riser.vdTotalPct as number).toBeCloseTo(
      (riser.vdUpstreamPct as number) + (riser.vdOwnPct as number),
      9,
    );
  });
});
