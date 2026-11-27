import type { BoardSchedule } from '@neuromep/shared';
import { meterCells } from './ScheduleSheet';

/** 1-Ph, 3-Ph, LV/HV meter counts. */
export type MeterTriple = [number, number, number];

export interface BoardMeterTotals {
  /**
   * Ways feeding a board that has meters: that board's total (accumulated down the chain), shown
   * read-only on the way. Other ways keep the meters placed on the plan for them.
   */
  accumulated: Record<string, { cells: MeterTriple; board: string }>;
  /** The footer TOTAL: incomer meters + every way (accumulated where it feeds a board). */
  total: MeterTriple;
}

const add = (a: MeterTriple, b: readonly (number | null)[]): MeterTriple => [
  a[0] + (b[0] ?? 0),
  a[1] + (b[1] ?? 0),
  a[2] + (b[2] ?? 0),
];
const any = (t: MeterTriple) => t[0] + t[1] + t[2] > 0;

/**
 * Meter totals of every board schedule (user request 26 Nov 2026): a board's TOTAL is the meters
 * on its incomer plus its outgoing ways; a way feeding another board carries that board's TOTAL,
 * so the totals accumulate up to the main panel. `all` must hold the schedules of every board,
 * not only the ones shown, so a board below is counted even when its level is not ticked.
 */
export function meterTotals(all: readonly BoardSchedule[]): Map<string, BoardMeterTotals> {
  const boards = new Map(all.filter((s) => s.kind === 'board').map((s) => [s.id, s]));
  const out = new Map<string, BoardMeterTotals>();
  const visiting = new Set<string>();

  const totalOf = (s: BoardSchedule): BoardMeterTotals => {
    const done = out.get(s.id);
    if (done) return done;
    visiting.add(s.id);
    const accumulated: BoardMeterTotals['accumulated'] = {};
    let total: MeterTriple = [0, 0, 0];
    for (const i of s.incomers) total = add(total, meterCells(i));
    for (const w of s.ways) {
      const child = w.childId ? boards.get(w.childId) : undefined;
      const below = child && !visiting.has(child.id) ? totalOf(child).total : null;
      if (below && any(below)) {
        accumulated[w.wayNo] = { cells: below, board: child!.tag };
        total = add(total, below);
      } else {
        total = add(total, meterCells(w));
      }
    }
    visiting.delete(s.id);
    const t = { accumulated, total };
    out.set(s.id, t);
    return t;
  };
  for (const s of all) if (s.kind === 'board') totalOf(s);
  // Busbar schedules: each tap-off way carries the board's total.
  for (const s of all) {
    if (s.kind !== 'busbar') continue;
    const accumulated: BoardMeterTotals['accumulated'] = {};
    let total: MeterTriple = [0, 0, 0];
    for (const w of s.ways) {
      const child = w.childId ? boards.get(w.childId) : undefined;
      const below = child ? out.get(child.id)!.total : null;
      if (below && any(below)) {
        accumulated[w.wayNo] = { cells: below, board: child!.tag };
        total = add(total, below);
      } else total = add(total, meterCells(w));
    }
    out.set(s.id, { accumulated, total });
  }
  return out;
}
