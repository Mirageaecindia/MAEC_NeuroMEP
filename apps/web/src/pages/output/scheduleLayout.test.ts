import type { BoardSchedule, ScheduleRow } from '@neuromep/shared';
import { describe, expect, it } from 'vitest';
import { scheduleLayout } from './scheduleLayout';

const row = (feeder: string, wayNo: string, remarks: string): ScheduleRow => ({
  feeder,
  wayNo,
  poles: 'TP',
  breakerA: 32,
  faultDutyKa: 10,
  cores: '1 x 4C',
  type: 'XLPE',
  sizeMm2: 10,
  eccMm2: 10,
  lengthM: 20,
  kw: { R: 1, Y: 1, B: 1 },
  tclKw: 3,
  mdKw: 3,
  remarks,
  problem: null,
  meters: null,
  childId: null,
});

const schedule = {
  id: 'B1',
  tag: 'SMDB-1',
  kind: 'board',
  description: null,
  project: 'P',
  location: '',
  connectedTo: null,
  transformer: null,
  incomers: [row('INCOMER', '-', '')],
  ways: [row('DB-1', '1RYB', 'ELCB 30 mA'), row('DB-2', '2RYB', 'ELCB 100 mA')],
  totals: { kw: { R: 2, Y: 2, B: 2 }, tclKw: 6, mdKw: 6 },
  demandFactor: 1,
  sizesPending: false,
} as unknown as BoardSchedule;

describe('scheduleLayout remarks (editable, 26 Nov 2026)', () => {
  it('writes the remark typed in the preview, else the system remark', () => {
    const l = scheduleLayout(schedule, {
      logo: null,
      completionDate: '',
      client: '',
      meters: {
        B1: {
          type: '',
          ctRatio: '',
          ways: {},
          remarks: { 'in:0': 'Main incomer from LV-1', '1RYB': 'Spare for future kitchen' },
        },
      },
    });
    expect(l.incomers[0]!.at(-1)).toBe('Main incomer from LV-1');
    expect(l.ways[0]!.at(-1)).toBe('Spare for future kitchen');
    expect(l.ways[1]!.at(-1)).toBe('ELCB 100 mA');
  });
});
