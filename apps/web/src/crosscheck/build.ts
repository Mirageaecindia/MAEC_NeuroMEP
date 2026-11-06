/**
 * WBS 1.7.5 #TASK-26 - writes the engineer cross-check pack to docs/crosscheck:
 *   CC-nn_<name>.json                    project file (Import File > Open project file)
 *   CC-nn_<name>_CalculationSheet.xlsx   the app's calculation sheet of that project
 *   NeuroMEP_CrossCheck_Worksheet.xlsx   NeuroMEP figure | engineer's hand value | difference
 *
 *   npm run crosscheck -w @neuromep/web   # after any engine or rule-pack change
 */
import { ENGINE_VERSION } from '@neuromep/engine';
import { serializeProject } from '@neuromep/shared';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calcSheetWorkbook } from '../pages/output/calcSheetFiles';
import { crossCheckCases, type CrossCheckCase } from './cases';
import { checkBlocks, PACK_RUN_AT, packProject, packSheet, type CheckBlock } from './pack';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/crosscheck');

/** Writes one pack file (names are built from the case ids above, never from input). */
const write = (name: string, data: string | Buffer) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed folder, case ids
  writeFileSync(join(out, name), data);

/** File name of a case: CC-01_Office_tower. */
export const caseFile = (c: CrossCheckCase) =>
  `${c.id}_${c.project.details.name.replace(/^CC-\d+\s+/, '').replace(/[^A-Za-z0-9]+/g, '_')}`;

const GREEN = 'FFC6EFCE';
const RED = 'FFFFC7CE';
const INPUT = 'FFFFF2CC';
const HEAD = 'FFD9E1F2';

async function worksheet(cases: { c: CrossCheckCase; blocks: CheckBlock[] }[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NeuroMEP';
  const run = `${PACK_RUN_AT.slice(0, 10)} - engine ${ENGINE_VERSION} - rule pack Dubai v1.0.0`;

  const intro = wb.addWorksheet('Read me');
  intro.columns = [{ width: 110 }];
  [
    'NeuroMEP - engineer cross-check of engine results (WBS 1.7.5)',
    `Cable Size run: ${run}`,
    '',
    'For each case, recalculate the figures by hand (or in your own sheet) and type your value in the yellow column.',
    'Selections (breaker rating and type, cable size, runs, ECC, check outcomes) must be identical; numbers within 0.5 % (AT-03).',
    'The Result column turns OK or CHECK. Write a remark against every CHECK: the hand method, the table value used, and which one you believe.',
    'You do not need every line: at least the featured feeders of each case in full, then any lines you want.',
    '',
    'Each case is also a project file (CC-nn_*.json): open it on the server with Import File > Open > Open project file,',
    'assign yourself as Electrical engineer on Import File, then see it in the Building tab, Schematic and Output.',
    'The calculation trace of every feeder (inputs, table values, formulas) is in the right panel on Floor Setup and in CC-nn_*_CalculationSheet.xlsx.',
    'All inputs are test data chosen to exercise the calculation - not design values.',
  ].forEach((t, i) => {
    const cell = intro.getCell(i + 1, 1);
    cell.value = t;
    if (i === 0) cell.font = { bold: true, size: 14 };
  });

  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 10 }, { width: 60 }, { width: 10 }, { width: 10 }, { width: 10 }];
  summary.addRow(['Case', 'Title', 'Lines', 'OK', 'CHECK']).font = { bold: true };

  for (const { c, blocks } of cases) {
    const ws = wb.addWorksheet(c.id, { views: [{ state: 'frozen', ySplit: 0 }] });
    ws.columns = [
      { width: 34 },
      { width: 22 },
      { width: 9 },
      { width: 14 },
      { width: 14 },
      { width: 11 },
      { width: 9 },
      { width: 48 },
    ];
    const title = ws.addRow([`${c.id} - ${c.title}`]);
    title.font = { bold: true, size: 13 };
    for (const line of c.covers) ws.addRow([`- ${line}`]);
    const featured = blocks
      .filter((b) => b.featured)
      .map((b) => `${b.title.split(' ')[0]} (${b.context.split(' | ')[0]})`);
    ws.addRow([`Featured - recalculate in full: ${featured.join(', ')}`]).font = { bold: true };
    ws.addRow([]);
    const first = ws.rowCount + 1;
    for (const b of blocks) {
      const head = ws.addRow([b.featured ? `${b.title} - FEATURED` : b.title, b.context]);
      head.font = { bold: true };
      head.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } };
      });
      const cols = ws.addRow([
        '',
        'Quantity',
        'Unit',
        'NeuroMEP',
        'Hand value',
        'Difference',
        'Result',
        'Remarks',
      ]);
      cols.font = { italic: true };
      for (const l of b.lines) {
        const row = ws.addRow(['', l.label, l.unit, l.engine]);
        const r = row.number;
        if (typeof l.engine === 'number' && l.digits !== undefined) {
          row.getCell(4).numFmt = l.digits === 0 ? '0' : `0.${'0'.repeat(l.digits)}`;
        }
        row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT } };
        if (!l.exact && typeof l.engine === 'number') {
          row.getCell(6).value = {
            formula: `IF(E${r}="","",IF(ABS(D${r})<1E-9,E${r}-D${r},(E${r}-D${r})/ABS(D${r})))`,
          };
          row.getCell(6).numFmt = '0.00%';
          row.getCell(7).value = { formula: `IF(E${r}="","",IF(ABS(F${r})<=0.005,"OK","CHECK"))` };
        } else {
          row.getCell(7).value = { formula: `IF(E${r}="","",IF(E${r}=D${r},"OK","CHECK"))` };
        }
      }
      ws.addRow([]);
    }
    const last = ws.rowCount;
    ws.addConditionalFormatting({
      ref: `G${first}:G${last}`,
      rules: [
        {
          type: 'cellIs',
          operator: 'equal',
          formulae: ['"OK"'],
          priority: 1,
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GREEN } } },
        },
        {
          type: 'cellIs',
          operator: 'equal',
          formulae: ['"CHECK"'],
          priority: 2,
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: RED } } },
        },
      ],
    });
    const lines = blocks.reduce((n, b) => n + b.lines.length, 0);
    summary.addRow([
      c.id,
      c.title,
      lines,
      { formula: `COUNTIF('${c.id}'!G:G,"OK")` },
      { formula: `COUNTIF('${c.id}'!G:G,"CHECK")` },
    ]);
  }
  return wb.xlsx.writeBuffer();
}

async function main() {
  mkdirSync(out, { recursive: true });
  const cases = crossCheckCases();
  const done: { c: CrossCheckCase; blocks: CheckBlock[] }[] = [];
  for (const c of cases) {
    const p = packProject(c);
    const name = caseFile(c);
    write(`${name}.json`, serializeProject(p));
    const sheet = await calcSheetWorkbook(packSheet(p), {
      client: p.details.clientName,
      run: `${PACK_RUN_AT.slice(0, 16).replace('T', ' ')} - engine ${ENGINE_VERSION}`,
    });
    write(`${name}_CalculationSheet.xlsx`, Buffer.from(sheet));
    const blocks = checkBlocks(p, c.featured);
    if (blocks.filter((b) => b.featured).length !== c.featured.length) {
      throw new Error(`${c.id}: a featured feeder is not in the calculation sheet`);
    }
    done.push({ c, blocks });
    console.log(`${c.id}: ${name}.json, ${name}_CalculationSheet.xlsx`);
  }
  const buf = await worksheet(done);
  write('NeuroMEP_CrossCheck_Worksheet.xlsx', Buffer.from(buf));
  console.log('NeuroMEP_CrossCheck_Worksheet.xlsx');
}

await main();
