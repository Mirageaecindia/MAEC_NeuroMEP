import { cableSize, elementResults, ENGINE_VERSION } from '@neuromep/engine';
import {
  CALC_COLUMNS,
  calculationSheet,
  inputsKey,
  loadSummaries,
  mergeRun,
  resultOf,
  type CalcCell,
  type CalcSheet,
  type Project,
} from '@neuromep/shared';
import { loadPowerFactors, rulePackForRegion } from '@neuromep/rulepacks';
import type { CrossCheckCase } from './cases';

/**
 * WBS 1.7.5 #TASK-26 - the cross-check pack: each case run through Cable Size as the app does
 * (whole project), its results stored in the project file, plus the rows the engineer compares.
 */

export const PACK_RUN_AT = '2026-11-06T08:00:00.000Z';

/** The case's project with the results of one whole-project Cable Size run (as stored by the app). */
export function packProject(c: CrossCheckCase): Project {
  const p = c.project;
  const outcome = cableSize(p);
  const results = mergeRun(p, { kind: 'project' }, elementResults(p, outcome), {
    runId: `cross-check-${c.id}`,
    at: PACK_RUN_AT,
    engineVersion: ENGINE_VERSION,
    inputsKey: inputsKey(p),
  });
  return { ...p, model: { ...p.model, results } };
}

export function packSheet(p: Project): CalcSheet {
  const pack = rulePackForRegion('dubai')!;
  return calculationSheet(p, loadSummaries(p, loadPowerFactors(p, pack)));
}

/** One figure to recalculate: exact for selections, within 0.5 % for numbers (AT-03). */
export interface CheckLine {
  label: string;
  unit: string;
  engine: CalcCell;
  /** Selections (breaker, size, runs, ECC, check outcomes) must be identical. */
  exact: boolean;
  /** Decimals shown (the calculation sheet's). */
  digits?: number;
}

export interface CheckBlock {
  /** Feeder ref, riser or tap-off. */
  title: string;
  context: string;
  /** One of the case's featured feeders: recalculated in full. */
  featured: boolean;
  lines: CheckLine[];
}

/** Columns that describe the feeder rather than result from the calculation. */
const CONTEXT = new Set([
  'ref',
  'kind',
  'from',
  'to',
  'method',
  'construction',
  'trays',
  'grouped',
  'spacing',
  'depthM',
  'status',
  'errors',
]);
/** Calculated selections: compared exactly. */
const EXACT = new Set([
  'voltageV',
  'phases',
  'inA',
  'device',
  'poles',
  'icuKa',
  'sizeMm2',
  'runs',
  'busbarA',
  'eccMm2',
  'vdLimitPct',
  'sizedBy',
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
  'C9',
]);

/** The figures of a project to recalculate, a block per feeder, riser and tap-off box. */
export function checkBlocks(p: Project, featured: readonly string[] = []): CheckBlock[] {
  const sheet = packSheet(p);
  const blocks: CheckBlock[] = sheet.rows.map((row) => {
    const cell = (k: string) => row[k];
    const name = cell('kind') === 'Riser' ? String(cell('ref')) : `${cell('from')} > ${cell('to')}`;
    const context = [
      `${cell('from')} > ${cell('to')}`,
      cell('construction'),
      cell('method'),
      cell('trays') == null ? null : `${cell('trays')} tray(s)`,
      cell('grouped') == null ? null : `${cell('grouped')} grouped`,
      cell('spacing') == null ? null : `spacing ${cell('spacing')}`,
      cell('depthM') == null ? null : `depth ${cell('depthM')} m`,
      `status ${cell('status')}`,
      cell('errors') ? `codes ${cell('errors')}` : null,
    ]
      .filter(Boolean)
      .join(' | ');
    return {
      title: `${cell('ref')} (${cell('kind')})`,
      context,
      featured: featured.includes(name),
      lines: CALC_COLUMNS.filter(
        (c) => !CONTEXT.has(c.key) && row[c.key] != null && row[c.key] !== '-',
      ).map((c) => ({
        label: `${c.step === 'CHECKS' ? 'Check ' : ''}${c.label}`,
        unit: c.unit,
        engine: row[c.key]!,
        exact: EXACT.has(c.key),
        ...(c.digits === undefined ? {} : { digits: c.digits }),
      })),
    };
  });
  // Tap-off boxes: the breaker in the tap-off box feeding each board on a riser.
  const key = inputsKey(p);
  p.model.risers.forEach((riser, i) => {
    for (const id of riser.feeds) {
      const r = resultOf(p, id, key)?.result;
      const board = p.model.elements.find((e) => e.id === id);
      if (!r || !board) continue;
      const lines: CheckLine[] = [
        { label: 'Load current Ib', unit: 'A', engine: r.values.ibA, exact: false, digits: 1 },
        { label: 'Rating In', unit: 'A', engine: r.values.inA, exact: true },
        { label: 'Breaker type', unit: '', engine: r.device?.type ?? null, exact: true },
        {
          label: 'Total drop at the tap-off',
          unit: '%',
          engine: r.values.vdTotalPct,
          exact: false,
          digits: 2,
        },
      ];
      blocks.push({
        title: `Tap-off box for ${board.tag} (Riser ${i + 1})`,
        context: `Riser ${i + 1} > ${board.tag} | status ${r.status}`,
        featured: false,
        lines: lines.filter((l) => l.engine !== null),
      });
    }
  });
  return blocks;
}
