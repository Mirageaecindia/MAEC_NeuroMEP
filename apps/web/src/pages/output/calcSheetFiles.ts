import { CALC_COLUMNS, type CalcCell, type CalcColumn, type CalcSheet } from '@neuromep/shared';

/** Title block of the calculation sheet: project, client, rule pack and the Cable Size run. */
export interface CalcSheetInfo {
  client: string;
  /** e.g. "2026-11-05 08:00 - engine 0.1.0", from the run made before the download. */
  run: string;
}

/** Relative column widths (Excel characters; scaled to the page in the PDF). */
const WIDTH: Record<string, number> = {
  ref: 14,
  kind: 11,
  from: 19,
  to: 21,
  construction: 19,
  method: 15,
  status: 11,
  errors: 11,
};
const widthOf = (c: CalcColumn) => WIDTH[c.key] ?? (/^C\d$/.test(c.key) ? 7 : 9);

/** A cell as shown in the preview and the PDF (numbers to their column's decimals). */
export function calcText(c: CalcColumn, v: CalcCell | undefined): string {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'number') return c.digits === undefined ? String(v) : v.toFixed(c.digits);
  return v;
}

/** Steps of the sheet with the columns they span, in order. */
export function calcSteps(): { step: string; span: number }[] {
  const steps: { step: string; span: number }[] = [];
  for (const c of CALC_COLUMNS) {
    const last = steps.at(-1);
    if (last?.step === c.step) last.span++;
    else steps.push({ step: c.step, span: 1 });
  }
  return steps;
}

const titleLines = (s: CalcSheet, info: CalcSheetInfo) => [
  `CALCULATION SHEET - PROJECT : ${s.project}`,
  `CLIENT : ${info.client || '-'}   RULE PACK : ${s.rulePack}   CABLE SIZE RUN : ${info.run}`,
];

/** The calculation sheet as one Excel worksheet, a row per cable / busbar feeder / riser. */
export async function calcSheetWorkbook(s: CalcSheet, info: CalcSheetInfo): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NeuroMEP';
  const ws = wb.addWorksheet('Calculation Sheet', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1 },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 6 }],
  });
  const n = CALC_COLUMNS.length;
  ws.columns = CALC_COLUMNS.map((c) => ({ width: widthOf(c) }));
  titleLines(s, info).forEach((t, i) => {
    ws.mergeCells(i + 1, 1, i + 1, n);
    const cell = ws.getCell(i + 1, 1);
    cell.value = t;
    cell.font = { bold: i === 0, size: i === 0 ? 12 : 9 };
  });
  let col = 1;
  for (const { step, span } of calcSteps()) {
    if (span > 1) ws.mergeCells(4, col, 4, col + span - 1);
    ws.getCell(4, col).value = step;
    col += span;
  }
  ws.getRow(5).values = CALC_COLUMNS.map((c) => c.label);
  ws.getRow(6).values = CALC_COLUMNS.map((c) => c.unit);
  s.rows.forEach((r, i) => {
    const row = ws.getRow(7 + i);
    CALC_COLUMNS.forEach((c, k) => {
      const v = r[c.key];
      const cell = row.getCell(k + 1);
      cell.value = v === null || v === undefined || v === '' ? '-' : v;
      if (typeof v === 'number' && c.digits !== undefined) {
        cell.numFmt = c.digits === 0 ? '0' : `0.${'0'.repeat(c.digits)}`;
      }
    });
  });
  const last = 6 + Math.max(s.rows.length, 1);
  for (let r = 4; r <= last; r++) {
    for (let c = 1; c <= n; c++) {
      const cell = ws.getCell(r, c);
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: c <= 4 ? 'left' : 'center',
        wrapText: true,
      };
      cell.font = { name: 'Arial', size: 8, bold: r <= 6 };
    }
  }
  ws.getRow(5).height = 30;
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

// PDF: A3 landscape in points.
const PAGE_W = 1190.55;
const PAGE_H = 841.89;
const MARGIN = 18;
const FONT = 5.5;
const LINE = 6.5;

/** The calculation sheet as a PDF on A3 landscape; the step, label and unit rows repeat per page. */
export async function calcSheetPdf(s: CalcSheet, info: CalcSheetInfo): Promise<ArrayBuffer> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });
  doc.setProperties({ title: 'Calculation sheet', creator: 'NeuroMEP' });
  doc.setLineWidth(0.4);
  const total = CALC_COLUMNS.reduce((a, c) => a + widthOf(c), 0);
  const unit = (PAGE_W - 2 * MARGIN) / total;
  const xs: number[] = [MARGIN];
  for (const c of CALC_COLUMNS) xs.push(xs.at(-1)! + widthOf(c) * unit);

  /**
   * Font size and lines of a cell: words are never split - a word wider than the cell shrinks the
   * font of that cell (down to 3.5 pt) instead.
   */
  const fit = (text: string, w: number, bold: boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(FONT);
    const widest = Math.max(...text.split(/\s+/).map((word) => doc.getTextWidth(word)));
    // jsPDF wraps a little sooner than getTextWidth measures: keep 10 % in hand.
    const size = Math.max(3.5, Math.min(FONT, (FONT * 0.9 * (w - 3)) / widest));
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, w - 3) as string[];
    doc.setFontSize(FONT);
    return { size, lines, line: (LINE * size) / FONT };
  };
  const box = (c1: number, c2: number, y: number, h: number, text: string, bold = false) => {
    const left = xs[c1]!;
    const w = xs[c2 + 1]! - left;
    doc.rect(left, y, w, h);
    if (!text) return;
    const { size, lines, line } = fit(text, w, bold);
    doc.setFontSize(size);
    const top = y + h / 2 - ((lines.length - 1) * line) / 2 + size / 3;
    doc.text(lines, c1 < 4 ? left + 1.5 : left + w / 2, top, {
      align: c1 < 4 ? 'left' : 'center',
      lineHeightFactor: LINE / FONT,
    });
    doc.setFontSize(FONT);
  };
  const height = (texts: string[], bold = false) =>
    Math.max(
      12,
      ...texts.map((t, i) => {
        const { lines, line } = fit(t, xs[i + 1]! - xs[i]!, bold);
        return lines.length * line + 4;
      }),
    );

  let y = MARGIN;
  const top = () => {
    y = MARGIN;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    const [title, sub] = titleLines(s, info);
    doc.text(title!, MARGIN, y + 10);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(sub!, MARGIN, y + 20);
    y += 28;
    doc.setFontSize(FONT);
    let col = 0;
    for (const { step, span } of calcSteps()) {
      box(col, col + span - 1, y, 11, step, true);
      col += span;
    }
    y += 11;
    const labels = CALC_COLUMNS.map((c) => c.label);
    const h = height(labels, true);
    labels.forEach((l, i) => box(i, i, y, h, l, true));
    y += h;
    CALC_COLUMNS.forEach((c, i) => box(i, i, y, 9, c.unit, true));
    y += 9;
  };
  top();
  for (const r of s.rows) {
    const texts = CALC_COLUMNS.map((c) => calcText(c, r[c.key]));
    const h = height(texts);
    if (y + h > PAGE_H - MARGIN) {
      doc.addPage('a3', 'landscape');
      top();
    }
    texts.forEach((t, i) => box(i, i, y, h, t));
    y += h;
  }
  if (s.rows.length === 0) box(0, CALC_COLUMNS.length - 1, y, 12, 'No feeders in this project.');
  return doc.output('arraybuffer');
}
