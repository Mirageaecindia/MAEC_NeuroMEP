import type { GeneratorAnalysis } from '@neuromep/shared';

/**
 * Generator Load Analysis files (briefing page 8): the columns of the example sheet, a coloured row
 * per panel (what feeds it and the panel), a row per load, the totals and the generator summary.
 * One layout for the preview, Excel and PDF.
 */

export const GEN_HEADS = [
  'FROM',
  'TO',
  'R-PH kW',
  'Y-PH kW',
  'B-PH kW',
  'TOTAL LOAD kW',
  'DEMAND FACTOR NORMAL',
  'DEMAND FACTOR CASE-1',
  'DEMAND FACTOR CASE-2',
  'NORMAL OPERATION kW',
  'CASE-1 POWER FAILURE kW',
  'CASE-2 FIRE CONDITION kW',
  'REMARKS',
];
/** Relative widths (Excel characters; scaled to the page in the PDF). */
const WIDTHS = [20, 26, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 16];

export const kw = (v: number) => v.toFixed(3);

export interface GenLine {
  kind: 'group' | 'row' | 'total';
  cells: string[];
  /** A load whose factors nobody has edited yet (shown highlighted). */
  unedited?: boolean;
}

export function genLines(g: GeneratorAnalysis): GenLine[] {
  const lines: GenLine[] = [];
  for (const group of g.groups) {
    lines.push({ kind: 'group', cells: [group.from, group.to] });
    for (const r of group.rows) {
      lines.push({
        kind: 'row',
        unedited: !r.edited,
        cells: [
          r.from,
          r.to,
          kw(r.kw.L1),
          kw(r.kw.L2),
          kw(r.kw.L3),
          kw(r.totalKw),
          kw(r.factors.normal),
          kw(r.factors.powerFailure),
          kw(r.factors.fire),
          kw(r.normalKw),
          kw(r.powerFailureKw),
          kw(r.fireKw),
          r.remarks,
        ],
      });
    }
  }
  const t = g.totals;
  lines.push({
    kind: 'total',
    cells: [
      'TOTAL',
      '',
      '',
      '',
      '',
      kw(t.connectedKw),
      '',
      '',
      '',
      kw(t.normalKw),
      kw(t.powerFailureKw),
      kw(t.fireKw),
      '',
    ],
  });
  return lines;
}

const whole = (v: number | null, unit: string) => (v === null ? '-' : `${Math.round(v)} ${unit}`);

/** The generator summary of the example: label, value, note. */
export function genSummary(g: GeneratorAnalysis): [string, string, string][] {
  return [
    [
      'LOAD ON GENERATOR',
      whole(g.loadKw, 'kW'),
      `Highest of the two (power failure, fire condition) considered: ${g.governing}`,
    ],
    [`SPARE CAPACITY (${g.sparePct ?? '-'} %)`, whole(g.spareKw, 'kW'), ''],
    ['GENERATOR RATING REQUIRED (kW)', whole(g.requiredKw, 'kW'), ''],
    [
      'GENERATOR RATING REQUIRED (kVA)',
      whole(g.requiredKva, 'kVA'),
      g.pf ? `kW / ${g.pf}` : 'Generator power factor not set in the rule pack',
    ],
    [
      'GENERATOR RATING SELECTED (kVA)',
      whole(g.selectedKva, 'kVA'),
      g.selectedKva === null
        ? `Enter the kVA of ${g.tag} in Floor Setup`
        : g.adequate === false
          ? `Below the required rating: choose a larger generator`
          : `${g.tag} in Floor Setup`,
    ],
  ];
}

export interface GenInfo {
  project: string;
  client: string;
}

const title = (g: GeneratorAnalysis, info: GenInfo) => [
  `LOAD ANALYSIS - GENERATORS - ${g.tag}`,
  `PROJECT : ${info.project}   CLIENT : ${info.client || '-'}`,
];

/** One Excel worksheet per generator. */
export async function generatorWorkbook(
  analyses: GeneratorAnalysis[],
  info: GenInfo,
): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NeuroMEP';
  const n = GEN_HEADS.length;
  for (const g of analyses) {
    const ws = wb.addWorksheet(g.tag.slice(0, 31).replace(/[\\/?*[\]:]/g, '-'), {
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1 },
      views: [{ state: 'frozen', ySplit: 4 }],
    });
    ws.columns = WIDTHS.map((width) => ({ width }));
    title(g, info).forEach((t, i) => {
      ws.mergeCells(i + 1, 1, i + 1, n);
      ws.getCell(i + 1, 1).value = t;
      ws.getCell(i + 1, 1).font = { bold: i === 0, size: i === 0 ? 12 : 9 };
    });
    ws.getRow(4).values = GEN_HEADS;
    ws.getRow(4).height = 30;
    let r = 5;
    for (const line of genLines(g)) {
      const row = ws.getRow(r);
      line.cells.forEach((v, k) => {
        const num = k >= 2 && k <= 11 && v !== '' ? Number(v) : null;
        row.getCell(k + 1).value = num ?? v;
        if (num !== null) row.getCell(k + 1).numFmt = '0.000';
      });
      if (line.kind !== 'row') {
        for (let c = 1; c <= n; c++) {
          row.getCell(c).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: line.kind === 'group' ? 'FFFFF59D' : 'FFFAD7C0' },
          };
        }
      }
      r++;
    }
    const last = r - 1;
    for (let y = 4; y <= last; y++) {
      for (let c = 1; c <= n; c++) {
        const cell = ws.getCell(y, c);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: c <= 2 || c === n ? 'left' : 'center',
          wrapText: true,
        };
        cell.font = { name: 'Arial', size: 8, bold: y === 4 || ws.getCell(y, 1).value === 'TOTAL' };
      }
    }
    r++;
    for (const [label, value, note] of genSummary(g)) {
      ws.mergeCells(r, 2, r, 5);
      ws.getCell(r, 2).value = label;
      ws.getCell(r, 6).value = value;
      ws.mergeCells(r, 7, r, n);
      ws.getCell(r, 7).value = note;
      for (const c of [2, 6, 7]) ws.getCell(r, c).font = { name: 'Arial', size: 9, bold: c !== 7 };
      r++;
    }
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

// PDF: A4 landscape in points.
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN = 20;
const FONT = 6.5;

/** A page (or more) per generator; the column heads repeat on every page. */
export async function generatorPdf(
  analyses: GeneratorAnalysis[],
  info: GenInfo,
): Promise<ArrayBuffer> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setProperties({ title: 'Generator load analysis', creator: 'NeuroMEP' });
  doc.setLineWidth(0.4);
  const total = WIDTHS.reduce((a, b) => a + b, 0);
  const xs = [MARGIN];
  for (const w of WIDTHS) xs.push(xs.at(-1)! + (w * (PAGE_W - 2 * MARGIN)) / total);
  const lineH = FONT * 1.2;

  const height = (cells: string[], bold: boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    return Math.max(
      12,
      ...cells.map(
        (t, i) => (doc.splitTextToSize(t, xs[i + 1]! - xs[i]! - 3) as string[]).length * lineH + 4,
      ),
    );
  };
  const row = (
    y: number,
    cells: string[],
    h: number,
    opts: { bold?: boolean; fill?: number[] },
  ) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    cells.forEach((t, i) => {
      const left = xs[i]!;
      const w = xs[i + 1]! - left;
      if (opts.fill) {
        doc.setFillColor(opts.fill[0]!, opts.fill[1]!, opts.fill[2]!);
        doc.rect(left, y, w, h, 'FD');
      } else doc.rect(left, y, w, h);
      if (!t) return;
      const lines = doc.splitTextToSize(t, w - 3) as string[];
      const top = y + h / 2 - ((lines.length - 1) * lineH) / 2 + FONT / 3;
      const leftAligned = i <= 1 || i === cells.length - 1;
      doc.text(lines, leftAligned ? left + 1.5 : left + w / 2, top, {
        align: leftAligned ? 'left' : 'center',
        lineHeightFactor: 1.2,
      });
    });
  };

  analyses.forEach((g, gi) => {
    if (gi > 0) doc.addPage('a4', 'landscape');
    let y = MARGIN;
    const head = () => {
      const [t, sub] = title(g, info);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(t!, MARGIN, y + 10);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(sub!, MARGIN, y + 21);
      y += 28;
      doc.setFontSize(FONT);
      const h = height(GEN_HEADS, true);
      row(y, GEN_HEADS, h, { bold: true });
      y += h;
    };
    head();
    for (const line of genLines(g)) {
      const cells =
        line.kind === 'group'
          ? [...line.cells, ...Array(GEN_HEADS.length - 2).fill('')]
          : line.cells;
      const h = height(cells, line.kind !== 'row');
      if (y + h > PAGE_H - MARGIN) {
        doc.addPage('a4', 'landscape');
        y = MARGIN;
        head();
      }
      row(y, cells, h, {
        bold: line.kind !== 'row',
        fill:
          line.kind === 'group'
            ? [255, 245, 157]
            : line.kind === 'total'
              ? [250, 215, 192]
              : undefined,
      });
      y += h;
    }
    y += 10;
    doc.setFontSize(8);
    for (const [label, value, note] of genSummary(g)) {
      if (y + 14 > PAGE_H - MARGIN) {
        doc.addPage('a4', 'landscape');
        y = MARGIN;
      }
      doc.setFont('helvetica', 'bold');
      doc.text(label, xs[1]!, y + 9);
      doc.text(value, xs[5]!, y + 9);
      doc.setFont('helvetica', 'normal');
      doc.text(note, xs[6]!, y + 9);
      y += 14;
    }
  });
  if (analyses.length === 0) doc.text('No generator in this project.', MARGIN, MARGIN + 10);
  return doc.output('arraybuffer');
}
