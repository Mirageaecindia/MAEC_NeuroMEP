import type { Project } from '../project/schema.js';
import type { Cable, CableConstruction } from './cable.js';
import type { Element } from './elements.js';
import type { LoadSummary } from './loads.js';
import { CheckCodeSchema, type CheckCode } from './results.js';
import { sldTree, type SldNode } from './schedule.js';
import { inputsKey, resultOf, type StoredResult } from './sizing.js';

/**
 * Calculation sheet (WBS 1.7.3, #TASK-31, Section 14 "Cable schedule"): one row per cable,
 * busbar feeder and riser with its inputs, results and check codes, grouped by the steps of the
 * CableSizer "cal" sheet (load, device, installation, current-carrying capacity, ECC, voltage
 * drop, short circuit, checks). Figures come from the last Cable Size run; inputs from the model.
 */

export type CalcCell = string | number | null;

export interface CalcColumn {
  key: string;
  step: string;
  label: string;
  unit: string;
  /** Decimals of a number column (Vd to 2 decimals, FR-36). */
  digits?: number;
}

const CHECKS = CheckCodeSchema.options.slice(0, 9) as CheckCode[]; // C1 - C9 are calculated

export const CALC_COLUMNS: readonly CalcColumn[] = [
  { key: 'ref', step: 'LOAD', label: 'Feeder ref', unit: '' },
  { key: 'kind', step: 'LOAD', label: 'Type', unit: '' },
  { key: 'from', step: 'LOAD', label: 'From', unit: '' },
  { key: 'to', step: 'LOAD', label: 'To', unit: '' },
  { key: 'voltageV', step: 'LOAD', label: 'Voltage', unit: 'V' },
  { key: 'phases', step: 'LOAD', label: 'Phases', unit: 'PH' },
  { key: 'loadKw', step: 'LOAD', label: 'Max. demand', unit: 'kW', digits: 2 },
  { key: 'pf', step: 'LOAD', label: 'Power factor', unit: '', digits: 2 },
  { key: 'ibA', step: 'LOAD', label: 'Load current Ib', unit: 'A', digits: 1 },
  { key: 'inA', step: 'DEVICE', label: 'Rating In', unit: 'A' },
  { key: 'device', step: 'DEVICE', label: 'Breaker type', unit: '' },
  { key: 'poles', step: 'DEVICE', label: 'Poles', unit: '' },
  { key: 'icuKa', step: 'DEVICE', label: 'Fault duty', unit: 'kA', digits: 1 },
  { key: 'method', step: 'INSTALLATION', label: 'Method', unit: '' },
  { key: 'construction', step: 'INSTALLATION', label: 'Construction', unit: '' },
  { key: 'trays', step: 'INSTALLATION', label: 'Trays', unit: '' },
  { key: 'grouped', step: 'INSTALLATION', label: 'Grouped circuits', unit: '' },
  { key: 'spacing', step: 'INSTALLATION', label: 'Spacing', unit: '' },
  { key: 'depthM', step: 'INSTALLATION', label: 'Depth', unit: 'm', digits: 2 },
  { key: 'lengthM', step: 'CURRENT CARRYING CAPACITY', label: 'Length', unit: 'm', digits: 2 },
  { key: 'sizeMm2', step: 'CURRENT CARRYING CAPACITY', label: 'Size', unit: 'mm²' },
  { key: 'runs', step: 'CURRENT CARRYING CAPACITY', label: 'Runs', unit: '' },
  { key: 'busbarA', step: 'CURRENT CARRYING CAPACITY', label: 'Busbar rating', unit: 'A' },
  { key: 'itA', step: 'CURRENT CARRYING CAPACITY', label: 'Rating It', unit: 'A', digits: 1 },
  { key: 'k1', step: 'CURRENT CARRYING CAPACITY', label: 'Temp. K1', unit: '', digits: 3 },
  { key: 'k2', step: 'CURRENT CARRYING CAPACITY', label: 'Grouping K2', unit: '', digits: 3 },
  { key: 'kr', step: 'CURRENT CARRYING CAPACITY', label: 'Soil Kr', unit: '', digits: 3 },
  { key: 'k3', step: 'CURRENT CARRYING CAPACITY', label: 'Depth K3', unit: '', digits: 3 },
  { key: 'ktot', step: 'CURRENT CARRYING CAPACITY', label: 'Overall Ktot', unit: '', digits: 3 },
  { key: 'izA', step: 'CURRENT CARRYING CAPACITY', label: 'Corrected Iz', unit: 'A', digits: 1 },
  { key: 'eccMm2', step: 'ECC', label: 'ECC size', unit: 'mm²' },
  { key: 'vuMvAm', step: 'VOLTAGE DROP', label: 'Unit drop', unit: 'mV/A/m', digits: 3 },
  { key: 'loadFactorK', step: 'VOLTAGE DROP', label: 'Riser factor k', unit: '', digits: 3 },
  { key: 'vdOwnV', step: 'VOLTAGE DROP', label: 'Feeder drop', unit: 'V', digits: 2 },
  { key: 'vdOwnPct', step: 'VOLTAGE DROP', label: 'Feeder drop', unit: '%', digits: 2 },
  { key: 'vdUpstreamPct', step: 'VOLTAGE DROP', label: 'Upstream drop', unit: '%', digits: 2 },
  { key: 'vdTotalPct', step: 'VOLTAGE DROP', label: 'Total drop', unit: '%', digits: 2 },
  { key: 'vdLimitPct', step: 'VOLTAGE DROP', label: 'Limit', unit: '%', digits: 2 },
  { key: 'ikMaxKa', step: 'SHORT CIRCUIT', label: 'Ik" max', unit: 'kA', digits: 2 },
  { key: 'ikMinKa', step: 'SHORT CIRCUIT', label: 'Ik" min', unit: 'kA', digits: 2 },
  { key: 'zsMohm', step: 'SHORT CIRCUIT', label: 'Zs', unit: 'mOhm', digits: 1 },
  ...CHECKS.map((c) => ({ key: c, step: 'CHECKS', label: c, unit: '' })),
  { key: 'sizedBy', step: 'CHECKS', label: 'Sized by', unit: '' },
  { key: 'status', step: 'CHECKS', label: 'Status', unit: '' },
  { key: 'errors', step: 'CHECKS', label: 'Codes', unit: '' },
];

export type CalcRow = Record<string, CalcCell>;

export interface CalcSheet {
  project: string;
  rulePack: string;
  rows: CalcRow[];
  /** Any row whose figures come from a run that is out of date or not run yet. */
  sizesPending: boolean;
}

const METHODS: Record<CableConstruction['method'], string> = {
  B: 'B - conduit / trunking',
  J: 'J - tray',
  'D-direct': 'D - direct buried',
  'D-duct': 'D - duct',
};

const STATUS: Record<StoredResult['status'], string> = {
  final: 'Final',
  provisional: 'Provisional',
  'awaiting-load': 'Awaiting load',
  blocked: 'Blocked',
  'out-of-date': 'Out of date',
};

/** Short check outcome: Pass / Fail / Warning / N.C. (not calculated) / N.R. / Blocked. */
function checkLabel(state: string | undefined): string {
  switch (state) {
    case 'pass':
      return 'Pass';
    case 'fail':
      return 'Fail';
    case 'warning':
      return 'Warning';
    case 'blocked':
      return 'Blocked';
    case 'not-required':
      return 'N.R.';
    case 'not-calculated':
      return 'N.C.';
    default:
      return '-';
  }
}

function construction(c: CableConstruction): string {
  const armour = c.armour === 'none' ? '' : `/${c.armour}`;
  return `${c.cores} ${c.conductor} ${c.insulation}${armour}/${c.sheath} ${c.voltageGrade}`;
}

/** Figures of a stored result (empty while there is none). */
function figures(found: ReturnType<typeof resultOf>): CalcRow {
  const r = found?.result;
  if (!r) {
    return { status: 'Not calculated', ...Object.fromEntries(CHECKS.map((c) => [c, '-'])) };
  }
  const c = r.calc;
  const ks = [c?.k1, c?.k2, c?.kr, c?.k3];
  const ktot = ks.every((k) => typeof k === 'number')
    ? (ks as number[]).reduce((a, k) => a * k, 1)
    : null;
  return {
    voltageV: c?.ibCase ? (c.ibCase === 'single-phase' ? 230 : 400) : null,
    phases: c?.ibCase ? (c.ibCase === 'single-phase' ? 1 : 3) : null,
    loadKw: r.load?.maxDemandKw ?? null,
    pf: c?.pf ?? null,
    ibA: r.values.ibA,
    inA: r.values.inA,
    device: r.device?.type ?? null,
    poles: r.device?.poles ?? null,
    icuKa: r.device?.faultRatingKa ?? null,
    sizeMm2: r.size?.sizeMm2 ?? null,
    runs: r.size?.runs ?? null,
    busbarA: c?.busbarA ?? null,
    itA: c?.itA ?? null,
    k1: c?.k1 ?? null,
    k2: c?.k2 ?? null,
    kr: c?.kr ?? null,
    k3: c?.k3 ?? null,
    ktot,
    izA: c?.busbarA ? null : r.values.izA,
    eccMm2: r.size?.eccMm2 ?? null,
    vuMvAm: c?.vuMvAm ?? null,
    loadFactorK: c?.loadFactorK ?? null,
    vdOwnV: c?.vdOwnV ?? null,
    vdOwnPct: r.values.vdOwnPct,
    vdUpstreamPct: c?.vdUpstreamPct ?? null,
    vdTotalPct: r.values.vdTotalPct,
    vdLimitPct: c?.vdLimitPct ?? null,
    ikMaxKa: r.values.ikMaxKa,
    ikMinKa: r.values.ikMinKa,
    zsMohm: r.values.zsMohm,
    ...Object.fromEntries(CHECKS.map((code) => [code, checkLabel(r.checks[code]?.state)])),
    sizedBy: r.sizedBy,
    status: found.outOfDate ? 'Out of date' : STATUS[r.status],
    errors: r.errors.join(', ') || null,
  };
}

function cableRow(
  p: Project,
  cable: Cable,
  byId: Map<string, Element>,
  key: string,
  summaries: Map<string, LoadSummary>,
): CalcRow {
  const found = resultOf(p, cable.id, key);
  const k = cable.construction;
  const busbar = cable.feederType === 'busbar';
  const fig = figures(found);
  return {
    ref: cable.tag,
    kind: busbar ? 'Busbar feeder' : 'Cable',
    from: byId.get(cable.from.elementId)?.tag ?? '-',
    to: byId.get(cable.to.elementId)?.tag ?? '-',
    ...fig,
    loadKw: fig.loadKw ?? summaries.get(cable.to.elementId)?.maxDemandKw ?? null,
    method: busbar ? null : METHODS[k.method],
    construction: busbar ? 'Busbar TPN+E' : construction(k),
    trays: busbar ? null : k.trays,
    grouped: busbar ? null : k.groupedCircuits,
    spacing: busbar ? null : k.separation,
    depthM: busbar ? null : k.depthM,
    lengthM: found?.result.size?.lengthM ?? found?.result.calc?.lengthM ?? null,
  };
}

function riserRow(p: Project, index: number, byId: Map<string, Element>, key: string): CalcRow {
  const r = p.model.risers[index]!;
  const found = resultOf(p, r.id, key);
  const fig = figures(found);
  return {
    ref: `Riser ${index + 1}`,
    kind: 'Riser',
    from: (r.fedFromId && byId.get(r.fedFromId)?.tag) || '-',
    to: r.feeds.map((id) => byId.get(id)?.tag ?? id).join(', ') || '-',
    ...fig,
    voltageV: fig.ibA === null || fig.ibA === undefined ? null : 400,
    phases: fig.ibA === null || fig.ibA === undefined ? null : 3,
    construction: 'Busbar TPN+E (tap-off)',
    lengthM: r.lengthM,
  };
}

/**
 * The calculation sheet of the whole project, in network order: from each source down
 * (feeders, then riser tap-offs, as the single-line diagram), then anything not reached.
 */
export function calculationSheet(p: Project, summaries: Map<string, LoadSummary>): CalcSheet {
  const key = inputsKey(p);
  const byId = new Map(p.model.elements.map((e) => [e.id, e]));
  const fed = new Set([
    ...p.model.cables.map((c) => c.to.elementId),
    ...p.model.risers.flatMap((r) => r.feeds),
  ]);
  const roots = p.model.elements.filter((e) => !fed.has(e.id));
  const cables = new Set<string>();
  const risers = new Set<number>();
  const rows: CalcRow[] = [];
  const walk = (n: SldNode) => {
    if (n.via?.kind === 'feeder' && !cables.has(n.via.cable.id)) {
      cables.add(n.via.cable.id);
      rows.push(cableRow(p, n.via.cable, byId, key, summaries));
    }
    if (n.via?.kind === 'riser' && !risers.has(n.via.riser - 1)) {
      risers.add(n.via.riser - 1);
      rows.push(riserRow(p, n.via.riser - 1, byId, key));
    }
    n.children.forEach(walk);
  };
  for (const root of roots) {
    const tree = sldTree(p.model, root.id);
    if (tree) walk(tree);
  }
  for (const c of p.model.cables) {
    if (!cables.has(c.id)) rows.push(cableRow(p, c, byId, key, summaries));
  }
  p.model.risers.forEach((r, i) => {
    if (!risers.has(i) && (r.fedFromId || r.feeds.length)) rows.push(riserRow(p, i, byId, key));
  });
  return {
    project: p.details.name,
    rulePack: `${p.rulePackId ?? '-'} v${p.rulePackVersion ?? '-'}`,
    rows,
    sizesPending: rows.some((r) => r.status === 'Out of date' || r.status === 'Not calculated'),
  };
}
