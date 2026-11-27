import type { BoardSchedule, MeterCounts, ScheduleRow } from '@neuromep/shared';
import { describe, expect, it } from 'vitest';
import { meterTotals } from './meterTotals';

const row = (wayNo: string, childId: string | null, meters: MeterCounts | null): ScheduleRow =>
  ({ wayNo, feeder: childId ?? 'X', childId, meters }) as unknown as ScheduleRow;
const board = (id: string, incomer: MeterCounts | null, ways: ScheduleRow[]): BoardSchedule =>
  ({
    id,
    tag: id,
    kind: 'board',
    incomers: [row('-', null, incomer)],
    ways,
  }) as unknown as BoardSchedule;
const m = (ph1: number, ph3: number, lvhv: number): MeterCounts => ({ ph1, ph3, lvhv });

describe('meterTotals (accumulated kWh meters, 26 Nov 2026)', () => {
  it('adds the meters of the boards below to the way that feeds them, up to the main panel', () => {
    // MDB -> SMDB (incomer meter 1 x 3-Ph) -> DB-1 (2 x 1-Ph placed) and DB-2 (1 x 1-Ph placed).
    const smdb = board('SMDB', m(0, 1, 0), [
      row('1RYB', 'DB-1', m(2, 0, 0)),
      row('2RYB', 'DB-2', m(1, 0, 0)),
    ]);
    const mdb = board('MDB', m(0, 0, 1), [
      row('1RYB', 'SMDB', m(0, 1, 0)),
      row('2RYB', 'X', m(0, 2, 0)),
    ]);
    const t = meterTotals([mdb, smdb]);
    expect(t.get('SMDB')!.total).toEqual([3, 1, 0]);
    // The MDB way to the SMDB shows the SMDB's total, not only the SMDB's own meter.
    expect(t.get('MDB')!.accumulated['1RYB']).toEqual({ cells: [3, 1, 0], board: 'SMDB' });
    expect(t.get('MDB')!.total).toEqual([3, 3, 1]);
  });

  it('keeps a way to a board with no meters editable (not accumulated)', () => {
    const db = board('DB', null, []);
    const mdb = board('MDB', null, [row('1RYB', 'DB', null)]);
    const t = meterTotals([mdb, db]);
    expect(t.get('MDB')!.accumulated).toEqual({});
    expect(t.get('MDB')!.total).toEqual([0, 0, 0]);
  });
});
