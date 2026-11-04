import type { BoardSchedule } from '@neuromep/shared';
import type { Worksheet } from 'exceljs';
import { COLUMNS, LAST, logoType, scheduleLayout, type ScheduleInputs } from './scheduleLayout';

/** ExcelJS is large: loaded the first time a schedule is downloaded. */
const excel = () => import('exceljs').then((m) => m.default);

/** A sheet name Excel accepts: no []:*?/\, at most 31 characters, unique in the workbook. */
function sheetName(tag: string, used: Set<string>): string {
  const base = tag.replace(/[[\]:*?/\\]/g, '-').slice(0, 28) || 'Schedule';
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  used.add(name.toLowerCase());
  return name;
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
  const type = logoType(inputs.logo);
  const logo = type ? wb.addImage({ base64: inputs.logo!, extension: type }) : null;
  const used = new Set<string>();

  for (const s of schedules) {
    const l = scheduleLayout(s, inputs);
    const ws = wb.addWorksheet(sheetName(s.tag, used), {
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1 },
    });
    ws.columns = COLUMNS.map(([, width]) => ({ width }));

    // Title block (rows 1 - 4).
    ws.mergeCells(1, 1, 4, 8);
    ws.getCell(1, 1).value = l.title;
    ws.mergeCells(1, 9, 4, 15);
    ws.getCell(1, 9).value = l.heading;
    ws.mergeCells(1, 16, 3, LAST);
    ws.getCell(1, 16).value = logo === null ? l.client : '';
    if (logo !== null) ws.addImage(logo, 'P1:T3');
    ws.mergeCells(4, 16, 4, LAST);
    ws.getCell(4, 16).value = l.location;
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
    };
    const line = (text: string) => {
      ws.mergeCells(r, 1, r, LAST);
      ws.getCell(r, 1).value = text;
      r++;
    };
    for (const i of l.incomers) write(i, true);
    line('OUTGOING WAYS:');
    ws.getCell(r - 1, 1).font = { bold: true };
    if (l.emptyWays) line(l.emptyWays);
    for (const w of l.ways) write(w);

    // Totals, demand factor, type of meter.
    ws.mergeCells(r, 1, r, 5);
    ws.getCell(r, 1).value = l.connectedTo;
    ws.mergeCells(r, 6, r, 10);
    ws.getCell(r, 6).value = 'TOTAL CONNECTED LOAD PER PHASE';
    l.totals.forEach((v, k) => (ws.getCell(r, 11 + k).value = v));
    ws.mergeCells(r, 16, r, LAST);
    ws.getCell(r, 16).value = 'TOTAL';
    ws.getRow(r).font = { bold: true };
    ws.getRow(r).height = 28;
    r++;
    ws.mergeCells(r, 1, r, 10);
    ws.getCell(r, 1).value = l.demand;
    ws.mergeCells(r, 11, r, LAST);
    ws.getCell(r, 11).value = l.tcl;
    ws.getRow(r).font = { bold: true };
    r++;
    ws.mergeCells(r, 1, r, LAST);
    ws.getCell(r, 1).value = l.meter;
    boxed(ws, 1, r);
    for (let x = 6; x < r; x++) ws.getRow(x).height ||= 18;
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
