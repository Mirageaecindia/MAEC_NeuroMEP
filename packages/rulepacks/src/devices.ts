import type { BreakerType, Devices } from './schema.js';

/**
 * Device lookups of a rule pack (10.5, 10.11, Appendix B) for the engine (#TASK-20, #TASK-25).
 * A missing value is never replaced by 0 or 1 (V-14): it returns null and the caller blocks the
 * element with its code. `interim: true` marks values to confirm (OI-03 or a DEWA table gap).
 */

/** In = lowest standard rating >= Ib (10.5); null above the largest rating (E2001). */
export function standardRating(d: Devices, ibA: number): number | null {
  return d.breakerRatingsA.find((r) => r >= ibA) ?? null;
}

/** Breaker type by rating (10.5): MCB / MCCB below 800 A, ACB at 800 A and above. */
export function breakerTypeFor(d: Devices, ratingA: number) {
  return d.breakerTypes.find((t) => ratingA <= t.maxRatingA) ?? null;
}

/**
 * DEWA minimum cable for a breaker rating (C6). A rating missing from the table takes the next
 * higher entry, flagged interim (decision 30 Oct 2026); null above the last entry (blocked).
 */
export function dewaMinimum(
  d: Devices,
  ratingA: number,
): { sizeMm2: number; runs: number; interim: boolean } | null {
  const row = [...d.dewaMinimumCable.rows]
    .sort((a, b) => a.breakerA - b.breakerA)
    .find((r) => r.breakerA >= ratingA);
  if (!row) return null;
  return { sizeMm2: row.sizeMm2, runs: row.runs, interim: row.breakerA !== ratingA };
}

/**
 * Breaking capacity (10.5, V-10): the lowest available rating >= Ik"max of the device type; if the
 * type has none, the next type (MCB > MCCB > ACB). Null above the highest rating (E2002).
 */
export function breakingCapacity(
  d: Devices,
  type: BreakerType,
  ikMaxKa: number,
): { type: BreakerType; ratingKa: number } | null {
  const from = d.breakerTypes.findIndex((t) => t.type === type);
  for (const t of d.breakerTypes.slice(Math.max(0, from))) {
    const ka = [...t.faultRatingsKa].sort((a, b) => a - b).find((k) => k >= ikMaxKa);
    if (ka !== undefined) return { type: t.type, ratingKa: ka };
  }
  return null;
}
