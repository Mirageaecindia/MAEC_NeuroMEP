import { describe, expect, it } from 'vitest';
import { checkNetworkFeeders } from './checks.js';
import { designFeeders } from './design.js';
import { building } from './fixtures/network.js';

const SQRT3 = Math.sqrt(3);
const ib = (kw: number, pf = 0.85) => (kw * 1000) / (SQRT3 * 400 * pf);

/** TX > LV panel > SMDB > DB (residential 30 kW, pf 0.85), Dubai non-Emaar, residential 0.65. */
function net() {
  const b = building();
  b.project.calculation.demandFactors.byCategory.residential = { value: 0.65, source: 'user' };
  b.add('transformer', 'tx', { kva: 1000, ukPct: 5, urPct: 1.2 });
  b.add('lv-panel', 'lv');
  b.add('smdb', 'smdb');
  b.db('db', [10, 10, 10], { demandCategory: 'residential' });
  b.feed('tx', 'lv', 10);
  b.feed('lv', 'smdb', 20);
  b.feed('smdb', 'db', 20);
  return b;
}
const into = (p: ReturnType<typeof net>['project'], id: string) =>
  designFeeders(p).find((f) => f.toId === id)!;

describe('A-30 Breaker / Cable Sizing Criteria', () => {
  it('default Demand - Calculated: category factor at the LV panel, 100 % below (briefing p.10)', () => {
    const p = net().project;
    expect(into(p, 'lv').ibA).toBeCloseTo(ib(30 * 0.65), 6);
    expect(into(p, 'smdb').ibA).toBeCloseTo(ib(30), 6);
    expect(into(p, 'db').ibA).toBeCloseTo(ib(30), 6);
  });

  it('Connected sizes on the connected load; User-defined on connected x the factor', () => {
    const p = net().project;
    p.calculation.sizingCriteria = {
      main: { basis: 'connected', mode: 'calculated', factor: null },
      smdb: { basis: 'demand', mode: 'user', factor: 0.8 },
    };
    expect(into(p, 'lv').ibA).toBeCloseTo(ib(30), 6);
    expect(into(p, 'smdb').ibA).toBeCloseTo(ib(24), 6);
    expect(
      into(p, 'smdb')
        .trace.map((t) => t.detail)
        .join(' '),
    ).toMatch(/user-defined demand factor 0\.8/);
  });

  it('User-defined without a factor blocks the feeder (E2003), never assumed', () => {
    const p = net().project;
    p.calculation.sizingCriteria = { db: { basis: 'demand', mode: 'user', factor: null } };
    const f = into(p, 'db');
    expect(f.status).toBe('blocked');
    expect(f.errors).toContain('E2003');
  });

  it('MCC takes the SMDB-level factor: Emaar 0.8 (user decision 26 Nov 2026)', () => {
    const b = building();
    b.project.calculation.demandMethod = 'dubai-emaar';
    b.project.calculation.demandFactors.secondLevel = { value: 0.8, source: 'user' };
    b.add('transformer', 'tx', { kva: 1000, ukPct: 5, urPct: 1.2 });
    b.add('lv-panel', 'lv');
    b.add('mcc', 'mcc', {
      powerFactor: 0.85,
      manualLoads: [{ method: 'kw', loadType: '2', kwL1: 10, kwL2: 10, kwL3: 10 }],
    });
    b.feed('tx', 'lv', 10);
    b.feed('lv', 'mcc', 20);
    const f = into(b.project, 'mcc');
    expect(f.ibA).toBeCloseTo(ib(24, f.pf!), 6);
  });

  it('a busbar riser carries the category demand of its tap-off boards (Calculated)', () => {
    const b = net();
    b.project.calculation.busbarMaker = 'gersan';
    b.project.model.risers = [
      { id: 'r1', fedFromId: 'lv', feeds: ['smdb'], lengthM: 20, widthM: null } as never,
    ];
    b.project.model.cables = b.project.model.cables.filter((c) => c.to.elementId !== 'smdb');
    const riser = () => checkNetworkFeeders(b.project).risers[0]!;
    expect(riser().ibA).toBeCloseTo(ib(30 * 0.65), 6);
    b.project.calculation.sizingCriteria = {
      riser: { basis: 'connected', mode: 'calculated', factor: null },
    };
    expect(riser().ibA).toBeCloseTo(ib(30), 6);
  });
});
