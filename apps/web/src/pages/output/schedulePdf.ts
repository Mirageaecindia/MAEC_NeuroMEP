import type { BoardSchedule } from '@neuromep/shared';
import type { jsPDF as JsPdf } from 'jspdf';
import {
  COLUMNS,
  LAST,
  logoType,
  scheduleLayout,
  type Cell,
  type ScheduleInputs,
  type ScheduleLayout,
} from './scheduleLayout';

// A4 landscape in points.
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN = 20;
const TITLE_ROW = 16;
const HEAD_H = 30;
const ROW_H = 14;
const LINE_H = 8;
const FONT = 7;
const FOOTER_H = 26 + ROW_H * 2;

const unit = (PAGE_W - 2 * MARGIN) / COLUMNS.reduce((a, [, w]) => a + w, 0);
/** Left edge of column c (1-based); x(LAST + 1) is the right edge of the sheet. */
const x = (c: number) => MARGIN + COLUMNS.slice(0, c - 1).reduce((a, [, w]) => a + w * unit, 0);

const text = (v: Cell) => (v === null ? '' : String(v));

/** Draws the schedules on one page each (more when the ways do not fit), as the preview. */
class Sheet {
  private y = MARGIN;
  constructor(
    private readonly doc: JsPdf,
    private readonly logo: string | null,
  ) {}

  /** A boxed cell over columns c1..c2 with wrapped, vertically centred text. */
  private box(c1: number, c2: number, y: number, h: number, value: Cell, bold = false) {
    const { doc } = this;
    const left = x(c1);
    const w = x(c2 + 1) - left;
    doc.rect(left, y, w, h);
    const s = text(value);
    if (!s) return;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(s, w - 4) as string[];
    const top = y + h / 2 - ((lines.length - 1) * LINE_H) / 2 + FONT / 3;
    const centred = c1 > 1;
    doc.text(lines, centred ? left + w / 2 : left + 2, top, {
      align: centred ? 'center' : 'left',
      lineHeightFactor: LINE_H / FONT,
    });
  }

  private lines(value: Cell, c1: number, c2: number): number {
    return (this.doc.splitTextToSize(text(value), x(c2 + 1) - x(c1) - 4) as string[]).length;
  }

  /** Title block (4 rows) and column heads, at the top of every page of a schedule. */
  private top(l: ScheduleLayout) {
    const { doc } = this;
    this.y = MARGIN;
    const y = this.y;
    doc.setFontSize(FONT);
    this.box(1, 8, y, TITLE_ROW * 4, l.title, true);
    this.box(9, 15, y, TITLE_ROW * 4, l.heading, true);
    if (this.logo) {
      const left = x(16);
      const w = x(LAST + 1) - left;
      const h = TITLE_ROW * 3;
      doc.rect(left, y, w, h);
      const p = doc.getImageProperties(this.logo);
      const k = Math.min((w - 4) / p.width, (h - 4) / p.height);
      const [iw, ih] = [p.width * k, p.height * k];
      doc.addImage(this.logo, left + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
    } else {
      this.box(16, LAST, y, TITLE_ROW * 3, l.client, true);
    }
    this.box(16, LAST, y + TITLE_ROW * 3, TITLE_ROW, l.location);
    this.y += TITLE_ROW * 4;
    doc.setFontSize(FONT - 0.5);
    COLUMNS.slice(0, LAST - 2).forEach(([label], i) =>
      this.box(i + 1, i + 1, this.y, HEAD_H, label, true),
    );
    this.box(LAST - 1, LAST, this.y, HEAD_H, COLUMNS[LAST - 2]![0], true);
    doc.setFontSize(FONT);
    this.y += HEAD_H;
  }

  /** A row on the page, or on a new page (title and heads repeated) when it does not fit. */
  private fit(l: ScheduleLayout, h: number, reserve = 0) {
    if (this.y + h + reserve > PAGE_H - MARGIN) {
      this.doc.addPage('a4', 'landscape');
      this.top(l);
    }
  }

  private row(l: ScheduleLayout, cells: Cell[], bold: boolean) {
    const n = Math.max(...cells.map((v, i) => this.lines(v, i + 1, i === LAST - 2 ? LAST : i + 1)));
    const h = Math.max(ROW_H, n * LINE_H + 4);
    this.fit(l, h);
    cells.forEach((v, i) =>
      i === LAST - 2
        ? this.box(LAST - 1, LAST, this.y, h, v, bold)
        : this.box(i + 1, i + 1, this.y, h, v, bold),
    );
    this.y += h;
  }

  private line(l: ScheduleLayout, value: string, bold = false) {
    this.fit(l, ROW_H);
    this.box(1, LAST, this.y, ROW_H, value, bold);
    this.y += ROW_H;
  }

  draw(s: BoardSchedule, inputs: ScheduleInputs, first: boolean) {
    const l = scheduleLayout(s, inputs);
    if (!first) this.doc.addPage('a4', 'landscape');
    this.top(l);
    for (const i of l.incomers) this.row(l, i, true);
    this.line(l, 'OUTGOING WAYS:', true);
    if (l.emptyWays) this.line(l, l.emptyWays);
    for (const w of l.ways) this.row(l, w, false);

    // Totals, demand factor, type of meter - kept together on the last page.
    this.fit(l, 0, FOOTER_H);
    const h = 26;
    this.box(1, 5, this.y, h, l.connectedTo, true);
    this.box(6, 10, this.y, h, 'TOTAL CONNECTED LOAD PER PHASE', true);
    l.totals.forEach((v, k) => this.box(11 + k, 11 + k, this.y, h, v, true));
    this.box(16, LAST, this.y, h, 'TOTAL', true);
    this.y += h;
    this.box(1, 10, this.y, ROW_H, l.demand, true);
    this.box(11, LAST, this.y, ROW_H, l.tcl, true);
    this.y += ROW_H;
    this.box(1, LAST, this.y, ROW_H, l.meter);
    this.y += ROW_H;
  }
}

/**
 * The selected schedules as one PDF (Section 14), a landscape A4 page per board or riser in the
 * layout of the Excel file and the preview. jsPDF loads only when a PDF is downloaded.
 */
export async function schedulePdf(
  schedules: readonly BoardSchedule[],
  inputs: ScheduleInputs,
): Promise<ArrayBuffer> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setProperties({ title: 'Panel schedules', creator: 'NeuroMEP' });
  doc.setLineWidth(0.5);
  const sheet = new Sheet(doc, logoType(inputs.logo) ? inputs.logo : null);
  schedules.forEach((s, i) => sheet.draw(s, inputs, i === 0));
  return doc.output('arraybuffer');
}
