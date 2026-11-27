import { describe, expect, it } from 'vitest';
import { cableRating } from './capacity.js';
import { cableSize } from './cableSize.js';
import { building } from './fixtures/network.js';

/** TX > MCC > motor 45 kW (pf from load type), DOL or star-delta. */
function net(starter: 'DOL' | 'star-delta') {
  const b = building();
  b.add('transformer', 'tx', { kva: 1000, ukPct: 5, urPct: 1.2 });
  b.add('mcc', 'mcc');
  b.add('motor', 'm', {
    manualLoads: [{ method: 'kw', loadType: '8', kwL1: 15, kwL2: 15, kwL3: 15 }],
    starter,
  });
  b.feed('tx', 'mcc', 10);
  b.feed('mcc', 'm', 40);
  return b;
}
const toMotor = (starter: 'DOL' | 'star-delta') =>
  cableSize(net(starter).project).feeders.find((f) => f.toId === 'm')!;

describe('A-36 star-delta starter: 2 cables, each on Ib / 3 (27 Nov 2026)', () => {
  it('a DOL motor feeder is one cable on Ib', () => {
    const f = toMotor('DOL');
    expect(f.starDelta).toBe(false);
    expect(f.size!.runs).toBe(1);
  });

  it('a star-delta feeder is 2 cables; Iz and the drop use Ib / 3 per cable', () => {
    const f = toMotor('star-delta');
    expect(f.starDelta).toBe(true);
    expect(f.size!.runs).toBe(2);
    expect(f.trace.map((t) => t.detail).join(' ')).toMatch(/2 cables, each sized on Ib \/ 3/);
    // Capacity: the current is shared by 3 (2 cables x 1.5).
    const b = net('star-delta');
    const cable = b.project.model.cables.find((c) => c.to.elementId === 'm')!;
    const site = { airC: 50, groundC: 40, soilResistivity: 2 };
    const r = cableRating(cable.construction, 3, f.size!.sizeMm2, 3, site);
    expect(r.ok && f.rating?.izA).toBeCloseTo(r.ok ? r.izA : 0, 9);
    // Drop: Vu x Ib x L / (1000 x 3).
    expect(f.drop!.vcV).toBeCloseTo((f.drop!.vuMvAm * f.ibA! * f.lengthM) / 3000, 9);
    // The breaker stays on the full Ib.
    expect(f.device!.ratingA).toBeGreaterThanOrEqual(f.ibA!);
  });

  it('a star-delta starter on equipment linked to an isolator counts too', () => {
    const b = building();
    b.add('transformer', 'tx', { kva: 1000, ukPct: 5, urPct: 1.2 });
    b.add('mcc', 'mcc');
    b.add('isolator-tp', 'iso', { starter: null });
    b.add('mechanical-equipment', 'pump', {
      fedFromId: 'iso',
      kw: 30,
      phases: '3P',
      powerFactor: 0.85,
      efficiency: 0.9,
      loadType: '8',
      starter: 'star-delta',
    });
    b.feed('tx', 'mcc', 10);
    b.feed('mcc', 'iso', 30);
    const f = cableSize(b.project).feeders.find((x) => x.toId === 'iso')!;
    expect(f.starDelta).toBe(true);
    expect(f.size?.runs).toBe(2);
  });
});
