import type { BoardSchedule, ScheduleRow } from '@neuromep/shared';
import { meterCells, METER_TYPES, type BoardMeters } from './ScheduleSheet';

/** The inputs asked at every download (decision 2 Nov 2026), shared by the Excel and PDF files. */
export interface ScheduleInputs {
  /** Logo as a PNG / JPEG data URL. */
  logo: string | null;
  completionDate: string;
  client: string;
  meters: Record<string, BoardMeters>;
}

/** Column heads and Excel widths (characters) of the company format (Figma screen 5). */
export const COLUMNS = [
  ['CIRCUIT / FEEDER', 18],
  ['WAY NO', 8],
  ['SP/TP', 7],
  ['ACB/MCCB (A)', 10],
  ['FAULT DUTY kA', 9],
  ['NO. OF CORES', 9],
  ['TYPE', 15],
  ['SIZE mm²', 8],
  ['ECC mm²', 8],
  ['LENGTH (m)', 9],
  ['R-PH kW', 9],
  ['Y-PH kW', 9],
  ['B-PH kW', 9],
  ['TCL kW', 9],
  ['MD kW', 9],
  ['1-PH', 6],
  ['3-PH', 6],
  ['LV/HV', 6],
  ['REMARKS', 16],
  ['', 9],
] as const;
/** 20 columns, as the preview; REMARKS spans the last two. */
export const LAST = COLUMNS.length;

export type Cell = string | number | null;

/** A schedule as the file shows it: the same text and figures in Excel and in PDF. */
export interface ScheduleLayout {
  title: string;
  heading: string;
  /** Shown where the logo goes when there is no logo. */
  client: string;
  location: string;
  /** Incomers (bold) and outgoing ways: 19 cells each, the last one = remarks. */
  incomers: Cell[][];
  ways: Cell[][];
  emptyWays: string | null;
  connectedTo: string;
  /** R, Y, B, TCL, MD. */
  totals: number[];
  demand: string;
  tcl: string;
  meter: string;
}

const cell = (v: number | null, digits = 0) => (v === null ? '-' : Number(v.toFixed(digits)));

function rowValues(r: ScheduleRow): Cell[] {
  return [
    r.poles,
    cell(r.breakerA),
    cell(r.faultDutyKa),
    r.cores,
    r.type,
    cell(r.sizeMm2),
    cell(r.eccMm2),
    cell(r.lengthM, 2),
    r.kw.R,
    r.kw.Y,
    r.kw.B,
    r.tclKw,
    r.mdKw,
  ];
}

export function scheduleLayout(s: BoardSchedule, inputs: ScheduleInputs): ScheduleLayout {
  const m = inputs.meters[s.id];
  const t = s.totals;
  const meter = METER_TYPES.find((x) => x.value === m?.type)?.label ?? '-';
  return {
    title: `PROJECT : ${s.project}\nPLANNED COMPLETION DATE : ${inputs.completionDate || '-'}\n\n${s.description ?? s.tag}`,
    heading: 'DETAILS OF CONNECTED LOAD, MAX. DEMAND & kWHR METERING',
    client: inputs.client,
    location: `LOCATION OF ${s.tag}: ${s.location || '-'}`,
    incomers: s.incomers.map((i) => [
      i.feeder,
      '-',
      ...rowValues(i),
      ...meterCells(i, undefined),
      i.remarks,
    ]),
    ways: s.ways.map((w) => [
      w.feeder,
      w.wayNo,
      ...rowValues(w),
      ...meterCells(w, m?.ways[w.wayNo]),
      w.remarks,
    ]),
    emptyWays: s.ways.length === 0 ? `No outgoing feeders from ${s.tag}.` : null,
    connectedTo: `${s.tag} CONNECTED TO: ${s.connectedTo ?? '-'}\nTRANSFORMER: ${s.transformer ?? '-'}`,
    totals: [t.kw.R, t.kw.Y, t.kw.B, t.tclKw, t.mdKw],
    demand: `DEMAND FACTOR: ${s.demandFactor === null ? '-' : s.demandFactor.toFixed(2)} - MAX. DEMAND: ${t.mdKw.toFixed(2)} kW`,
    tcl: `* OVERALL TOTAL CONNECTED / INSTALLED LOAD (TCL): ${t.tclKw.toFixed(2)} kW`,
    meter: `Type of Meter (rating of incomer): ${meter}${m?.type === 'lv-ct' ? ` - CT ratio ${m.ctRatio}` : ''}`,
  };
}

/** The image type of a logo data URL; only PNG and JPEG go into both files. */
export const logoType = (logo: string | null) =>
  logo?.match(/^data:image\/(png|jpeg);base64,/)?.[1] as 'png' | 'jpeg' | undefined;
