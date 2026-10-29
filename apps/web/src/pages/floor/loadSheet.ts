import { LOAD_TYPE_LABELS, loadTemplateHeader, type Cell, type Element } from '@neuromep/shared';

/** ExcelJS is large: loaded the first time a load sheet is read or written. */
const excel = () => import('exceljs').then((m) => m.default);

/** A cell value as a plain string or number (formulas give their result, rich text its text). */
function plain(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if ('result' in o) return plain(o.result);
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (typeof o.text === 'string') return o.text;
  }
  return String(v);
}

/** The rows of the first worksheet of an .xlsx file. */
export async function readSheetRows(file: Blob): Promise<Cell[][]> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    // ExcelJS rows are 1-based: index 0 is always empty.
    rows[n - 1] = (row.values as unknown[]).slice(1).map(plain);
  });
  return Array.from(rows, (r) => r ?? []);
}

/**
 * The NeuroMEP DB load template (FR-35), one row per DB of the project with its current kW per
 * phase, so the sheet can be filled in and uploaded again.
 */
export async function loadTemplate(dbs: readonly (Element & { kind: 'db' })[]): Promise<Blob> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DB loads');
  const header = loadTemplateHeader();
  ws.addRow(header).font = { bold: true };
  for (const db of dbs) {
    const values: (string | number | null)[] = header.map(() => null);
    values[0] = db.tag;
    for (const line of db.loads) {
      const at = (c: string) => header.indexOf(`${LOAD_TYPE_LABELS[line.loadType]} ${c}`);
      if (line.method === 'kw') {
        values[at('L1 kW')] = line.kwL1;
        values[at('L2 kW')] = line.kwL2;
        values[at('L3 kW')] = line.kwL3;
      } else if (line.phases === '3P') {
        values[at('area m2')] = line.areaM2;
        values[at('W/m2')] = line.wPerM2;
      }
    }
    ws.addRow(values);
  }
  ws.getColumn(1).width = 22;
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
