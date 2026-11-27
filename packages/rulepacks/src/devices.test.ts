import { describe, expect, it } from 'vitest';
import { breakerTypeFor, breakingCapacity, dewaMinimum, standardRating } from './devices.js';
import { rulePackForRegion } from './registry.js';

const d = rulePackForRegion('dubai')!.devices;

describe('#TASK-29 Dubai rule pack v1 device data (Appendix B, 10.5)', () => {
  it('holds the Appendix B lists', () => {
    // 20 A is the smallest rating (user decision 27 Nov 2026).
    expect(d.breakerRatingsA).toHaveLength(31);
    expect(d.breakerRatingsA[0]).toBe(20);
    expect(d.cableSizesMm2).toEqual([
      1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630,
    ]);
    expect(d.dewaMinimumCable.rows).toHaveLength(27);
  });

  it('picks the lowest standard rating >= Ib, none above 10000 A (E2001)', () => {
    expect(standardRating(d, 6)).toBe(20);
    expect(standardRating(d, 13)).toBe(20);
    expect(standardRating(d, 63)).toBe(63);
    expect(standardRating(d, 64)).toBe(80);
    expect(standardRating(d, 10001)).toBeNull();
  });

  it('types breakers: no MCB; MCCB below 800 A, ACB from 800 A (27 Nov 2026)', () => {
    expect(d.breakerTypes.map((t) => t.type)).toEqual(['MCCB', 'ACB']);
    expect(breakerTypeFor(d, 20)).toMatchObject({ type: 'MCCB', interim: false });
    expect(breakerTypeFor(d, 63)?.type).toBe('MCCB');
    expect(breakerTypeFor(d, 80)?.type).toBe('MCCB');
    expect(breakerTypeFor(d, 630)?.type).toBe('MCCB');
    expect(breakerTypeFor(d, 800)?.type).toBe('ACB');
  });

  it('gives the DEWA minimum; a missing rating takes the next entry, flagged (C6)', () => {
    expect(dewaMinimum(d, 630)).toEqual({ sizeMm2: 185, runs: 2, interim: false });
    expect(dewaMinimum(d, 320)).toEqual({ sizeMm2: 240, runs: 1, interim: true });
    expect(dewaMinimum(d, 500)).toEqual({ sizeMm2: 185, runs: 2, interim: true });
    expect(dewaMinimum(d, 6)).toEqual({ sizeMm2: 4, runs: 1, interim: true });
    expect(dewaMinimum(d, 3200)).toBeNull();
  });

  it('selects the lowest breaking capacity >= Ik, moving up a type, none above 85 kA (E2002)', () => {
    expect(breakingCapacity(d, 'MCCB', 9)).toEqual({ type: 'MCCB', ratingKa: 25 });
    expect(breakingCapacity(d, 'MCCB', 30)).toEqual({ type: 'MCCB', ratingKa: 36 });
    expect(breakingCapacity(d, 'MCCB', 70)).toEqual({ type: 'ACB', ratingKa: 85 });
    expect(breakingCapacity(d, 'ACB', 86)).toBeNull();
  });
});
