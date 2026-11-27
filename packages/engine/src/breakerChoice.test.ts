import { describe, expect, it } from 'vitest';
import { getRulePack } from '@neuromep/rulepacks';
import { cableSize } from './cableSize.js';
import { breakerDuty } from './duty.js';
import { building } from './fixtures/network.js';
import { elementResults } from './results.js';

/** TX 1000 kVA > MDB > DB 15 kW: the DB feeder is a 20-40 A MCCB by default. */
function net() {
  const b = building();
  b.project.calculation.checks.shortCircuit = true;
  b.add('transformer', 'tx', { kva: 1000, ukPct: 5, urPct: 1.2 });
  b.add('mdb', 'mdb');
  b.db('db', [5, 5, 5]);
  b.feed('tx', 'mdb', 10);
  b.feed('mdb', 'db', 30);
  return b;
}
const toDb = (b: ReturnType<typeof net>) =>
  cableSize(b.project).feeders.find((f) => f.toId === 'db')!;

describe('A-34 breaker type chosen in the calculation sheet', () => {
  it('default logic: MCCB, no flag', () => {
    const f = toDb(net());
    expect(f.device?.type).toBe('MCCB');
    expect(f.errors).not.toContain('W2004');
  });

  it('a different choice is used, flagged W2004 and stored with the default type', () => {
    const b = net();
    b.project.model.cables.find((c) => c.to.elementId === 'db')!.breakerType = 'ACB';
    const f = toDb(b);
    expect(f.device?.type).toBe('ACB');
    expect(f.errors).toContain('W2004');
    expect(f.trace.map((t) => t.detail).join(' ')).toMatch(
      /Breaker type ACB chosen by the engineer; the default is MCCB \(W2004\)/,
    );
    const r = elementResults(b.project, cableSize(b.project)).find(
      (x) => x.elementId === f.cableId,
    )!;
    expect(r.device).toMatchObject({ type: 'ACB', defaultType: 'MCCB' });
  });

  it('choosing the default type is not flagged', () => {
    const b = net();
    b.project.model.cables.find((c) => c.to.elementId === 'db')!.breakerType = 'MCCB';
    expect(toDb(b).errors).not.toContain('W2004');
  });

  it('a chosen type is never moved up: a chosen MCCB above 65 kA has no duty (C3 fails); the default moves to ACB', () => {
    const p = net().project;
    const devices = getRulePack(p.rulePackId!, p.rulePackVersion!).devices;
    expect(breakerDuty(devices, 'MCCB', 70, 100)).toMatchObject({ type: 'ACB' });
    expect(breakerDuty(devices, 'MCCB', 70, 100, true)).toBeNull();
    expect(breakerDuty(devices, 'MCCB', 40, 60, true)).toMatchObject({ type: 'MCCB', icuKa: 50 });
  });
});
