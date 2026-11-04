import type { BoardSchedule, ScheduleRow } from '@neuromep/shared';
import type { Worksheet } from 'exceljs';
import { METER_TYPES, type BoardMeters } from './ScheduleSheet';

/** ExcelJS is large: loaded the first time a schedule is downloaded. */
const excel = () => import('exceljs').then((m) => m.default);

export interface ScheduleInputs {
  /** Logo as a PNG / JPEG data URL (asked at every download, decision 2 Nov 2026). */
  logo: string | null;
  completionDate: string;
  client: string;
  meters: Record<string, BoardMeters>;
}

const COLUMNS = [
  ['CIRCUIT / FEEDER', 18],
  ['WAY NO', 8],
  ['SP/TP', 7],
  ['ACB/MCCB (A)', 10],
  ['FAULT DUTY kA', 9],
  ['NO. OF CORES', 9],
  ['TYPE', 12],
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
  ['LV CT', 6],
  ['REMARKS', 16],
  ['', 12],
] as const;
const LAST = COLUMNS.length; // 20 columns, as the preview

/** A sheet name Excel accepts: no []:*?/\, at most 31 characters, unique in the workbook. */
function sheetName(tag: string, used: Set<string>): string {
  const base = tag.replace(/[[\]:*?/\\]/g, '-').slice(0, 28) || 'Schedule';
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  used.add(name.toLowerCase());
  return name;
}

const cell = (v: number | null, digits = 0) => (v === null ? '-' : Number(v.toFixed(digits)));

function rowValues(r: ScheduleRow): (string | number)[] {
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

function boxed(ws: Worksheet, from: number, to: number) {
  for (let r = from; r <= to; r++) {
    for (let c = 1; c <= LAST; c++) {
      const x = ws.getCell(r, c);
      x.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
      x.alignment = { vertical: 'middle', horizontal: c === 1 ? 'left' : 'center', wrapText: true };
      x.font = { name: 'Arial', size: 9, ...(x.font?.bold ? { bold: true } : {}) };
    }
  }
}

/**
 * The selected schedules as one workbook, a sheet per board or riser in the company format of the
 * preview (Figma screen 5, Section 14): title block, incomers, outgoing ways, totals, demand
 * factor, meters and type of meter.
 */
export async function scheduleWorkbook(
  schedules: readonly BoardSchedule[],
  inputs: ScheduleInputs,
): Promise<ArrayBuffer> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NeuroMEP';
  const logoMatch = inputs.logo?.match(/^data:image\/(png|jpeg);base64,/);
  const logo = logoMatch
    ? wb.addImage({ base64: inputs.logo!, extension: logoMatch[1] as 'png' | 'jpeg' })
    : null;
  const used = new Set<string>();

  for (const s of schedules) {
    const m = inputs.meters[s.id];
    const ws = wb.addWorksheet(sheetName(s.tag, used), {
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1 },
    });
    ws.columns = COLUMNS.map(([, width]) => ({ width }));

    // Title block (rows 1 - 4).
    ws.mergeCells(1, 1, 4, 8);
    ws.getCell(1, 1).value =
      `PROJECT : ${s.project}\nPLANNED COMPLETION DATE : ${inputs.completionDate || '-'}\n\n${s.description ?? s.tag}`;
    ws.mergeCells(1, 9, 4, 15);
    ws.getCell(1, 9).value = 'DETAILS OF CONNECTED LOAD, MAX. DEMAND & kWHR METERING';
    ws.mergeCells(1, 16, 3, LAST);
    ws.getCell(1, 16).value = logo === null ? inputs.client : '';
    if (logo !== null) ws.addImage(logo, 'P1:T3');
    ws.mergeCells(4, 16, 4, LAST);
    ws.getCell(4, 16).value = `LOCATION OF ${s.tag}: ${s.location || '-'}`;
    for (let r = 1; r <= 4; r++) ws.getRow(r).height = 22;
    for (const c of [1, 9, 16]) ws.getCell(1, c).font = { bold: true };

    // Column heads.
    const head = ws.getRow(5);
    head.values = COLUMNS.map(([label]) => label);
    ws.mergeCells(5, 19, 5, LAST);
    head.font = { bold: true };
    head.height = 30;

    let r = 6;
    const write = (values: (string | number | null)[], bold = false) => {
      const row = ws.getRow(r);
      row.values = values;
      if (bold) row.font = { bold: true };
      ws.mergeCells(r, 19, r, LAST);
      r++;
      return row;
    };
    for (const i of s.incomers) {
      write([i.feeder, '-', ...rowValues(i), null, null, null, i.remarks], true);
    }
    ws.mergeCells(r, 1, r, LAST);
    ws.getCell(r, 1).value = 'OUTGOING WAYS:';
    ws.getCell(r, 1).font = { bold: true };
    r++;
    if (s.ways.length === 0) {
      ws.mergeCells(r, 1, r, LAST);
      ws.getCell(r, 1).value = `No outgoing feeders from ${s.tag}.`;
      r++;
    }
    for (const w of s.ways) {
      const v = m?.ways[w.wayNo];
      write([
        w.feeder,
        w.wayNo,
        ...rowValues(w),
        v?.ph1 ?? null,
        v?.ph3 ?? null,
        v?.ct ?? null,
        w.remarks,
      ]);
    }

    // Totals, demand factor, type of meter.
    ws.mergeCells(r, 1, r, 5);
    ws.getCell(r, 1).value =
      `${s.tag} CONNECTED TO: ${s.connectedTo ?? '-'}\nTRANSFORMER: ${s.transformer ?? '-'}`;
    ws.mergeCells(r, 6, r, 10);
    ws.getCell(r, 6).value = 'TOTAL CONNECTED LOAD PER PHASE';
    const t = s.totals;
    [t.kw.R, t.kw.Y, t.kw.B, t.tclKw, t.mdKw].forEach((v, k) => (ws.getCell(r, 11 + k).value = v));
    ws.mergeCells(r, 16, r, LAST);
    ws.getCell(r, 16).value = 'TOTAL';
    ws.getRow(r).font = { bold: true };
    ws.getRow(r).height = 28;
    r++;
    ws.mergeCells(r, 1, r, 10);
    ws.getCell(r, 1).value =
      `DEMAND FACTOR: ${s.demandFactor === null ? '-' : s.demandFactor.toFixed(2)} - MAX. DEMAND: ${t.mdKw.toFixed(2)} kW`;
    ws.mergeCells(r, 11, r, LAST);
    ws.getCell(r, 11).value =
      `* OVERALL TOTAL CONNECTED / INSTALLED LOAD (TCL): ${t.tclKw.toFixed(2)} kW`;
    ws.getRow(r).font = { bold: true };
    r++;
    ws.mergeCells(r, 1, r, LAST);
    const meter = METER_TYPES.find((x) => x.value === m?.type)?.label ?? '-';
    ws.getCell(r, 1).value =
      `Type of Meter (rating of incomer): ${meter}${m?.type === 'lv-ct' ? ` - CT ratio ${m.ctRatio}` : ''}`;
    boxed(ws, 1, r);
    for (let x = 6; x < r; x++) ws.getRow(x).height ||= 18;
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
