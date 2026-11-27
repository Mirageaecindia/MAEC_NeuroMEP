import { ERROR_CATALOGUE } from '../errors/catalogue.js';
import type { Project } from '../project/schema.js';
import type { Cable, CableConstruction } from './cable.js';
import type { Element } from './elements.js';
import type { LoadSummary } from './loads.js';
import { CheckCodeSchema, type CheckCode, type ElementResult } from './results.js';
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
  /** What the column means, shown on hover (check columns C1 - C9, 26 Nov 2026). */
  hint?: string;
}

/**
 * What each check tests, in plain words (user request 26 Nov 2026): the headers stay C1 - C9 and
 * this is shown when the header or a cell of the column is hovered (Excel: a note on the header).
 */
export const CHECK_HINTS: Record<string, string> = {
  C1: 'C1 Current-carrying capacity: the corrected cable rating Iz (It x K1 x K2 x Kr x K3, x runs) must be at least the breaker rating In.',
  C2: 'C2 Voltage drop: the total drop from the source to the end of this feeder must be within the limit of the board it feeds.',
  C3: 'C3 Breaking capacity: the breaker Icu must be at least Ik" max at its board, and its making capacity at least the peak ip.',
  C4: 'C4 Let-through energy (adiabatic): phase S1 = Isc x sqrt(t1) / k1 and earth conductor S2 = Ief x sqrt(t2) / k2 must not exceed the installed areas; t1 / t2 = clearing times from Import File (0.05 s). A shortfall is a warning only. Only when ticked on Page 1.',
  C5: 'C5 Earth-fault loop: Zs must be low enough for the breaker to disconnect in time (Zs <= 0.95 x 230 / Ia). Only when ticked on Page 1; not required behind an ELCB.',
  C6: 'C6 Minimum size: size x runs must be at least the DEWA minimum cable for the breaker rating.',
  C7: 'C7 Board / busbar withstand: the board or busbar fed must withstand the fault there (Icw >= Ik" max, Ipk >= ip).',
  C8: 'C8 Safety category: essential and fire & life-safety loads need a generator on their supply path; critical loads also a UPS.',
  C9: 'C9 Fire-rated path: feeders on a fire & life-safety path to the generator should be fire-rated (warning only).',
};

/** What the short results in the check columns mean. */
export const CHECK_STATES =
  'Pass / Fail / Warning; N.C. = not calculated (not ticked on Page 1 or data missing); N.R. = not required; Blocked = input missing; - = no result.';

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
  // One earth conductor per run (decision 3 Nov 2026); own column, user request 26 Nov 2026.
  { key: 'eccRuns', step: 'ECC', label: 'ECC runs', unit: '' },
  // VDr / VDx, Vu = VDr cos + VDx sin (CableSizer manual 3.2; 26 Nov 2026): '-' below 25 mm².
  { key: 'vdrMvAm', step: 'VOLTAGE DROP', label: 'VDr', unit: 'mV/A/m', digits: 3 },
  { key: 'vdxMvAm', step: 'VOLTAGE DROP', label: 'VDx', unit: 'mV/A/m', digits: 3 },
  { key: 'vuMvAm', step: 'VOLTAGE DROP', label: 'Unit drop', unit: 'mV/A/m', digits: 3 },
  // How the figures were worked out, with the row's own numbers (user request 27 Nov 2026).
  { key: 'vuFormula', step: 'VOLTAGE DROP', label: 'Unit drop formula', unit: '' },
  { key: 'loadFactorK', step: 'VOLTAGE DROP', label: 'Riser factor k', unit: '', digits: 3 },
  { key: 'vdOwnV', step: 'VOLTAGE DROP', label: 'Feeder drop', unit: 'V', digits: 2 },
  { key: 'vdFormula', step: 'VOLTAGE DROP', label: 'Feeder drop formula', unit: '' },
  { key: 'vdOwnPct', step: 'VOLTAGE DROP', label: 'Feeder drop', unit: '%', digits: 2 },
  { key: 'vdUpstreamPct', step: 'VOLTAGE DROP', label: 'Upstream drop', unit: '%', digits: 2 },
  { key: 'vdTotalPct', step: 'VOLTAGE DROP', label: 'Total drop', unit: '%', digits: 2 },
  { key: 'vdLimitPct', step: 'VOLTAGE DROP', label: 'Limit', unit: '%', digits: 2 },
  // This cable's R / X (cold), as the CableSizer cal sheet Rk / Xk (26 Nov 2026).
  { key: 'rkMohm', step: 'SHORT CIRCUIT', label: 'Rk', unit: 'mOhm', digits: 3 },
  { key: 'xkMohm', step: 'SHORT CIRCUIT', label: 'Xk', unit: 'mOhm', digits: 3 },
  { key: 'ikMaxKa', step: 'SHORT CIRCUIT', label: 'Ik" max', unit: 'kA', digits: 2 },
  { key: 'scFormula', step: 'SHORT CIRCUIT', label: 'Short-circuit formula', unit: '' },
  { key: 'ikMinKa', step: 'SHORT CIRCUIT', label: 'Ik" min', unit: 'kA', digits: 2 },
  { key: 'zsMohm', step: 'SHORT CIRCUIT', label: 'Zs', unit: 'mOhm', digits: 1 },
  ...CHECKS.map((c) => ({ key: c, step: 'CHECKS', label: c, unit: '', hint: CHECK_HINTS[c] })),
  { key: 'sizedBy', step: 'CHECKS', label: 'Sized by', unit: '' },
  { key: 'status', step: 'CHECKS', label: 'Status', unit: '' },
  { key: 'errors', step: 'CHECKS', label: 'Codes', unit: '' },
  // Why a row has no figures (user report 15 Nov 2026: blank cells with no reason).
  { key: 'note', step: 'CHECKS', label: 'Why not sized', unit: '' },
];

export type CalcRow = Record<string, CalcCell>;

export interface CalcSheet {
  project: string;
  rulePack: string;
  rows: CalcRow[];
  /** Any row whose figures come from a run that is out of date or not run yet. */
  sizesPending: boolean;
  /** Why rows have no figures, by cause, so the engineer can fix the source (15 Nov 2026). */
  notSized: NotSized;
}

export interface NotSized {
  /** Feeders to components with no load entered on them or below (status Awaiting load). */
  awaitingLoad: string[];
  /** Components with a load but no power factor: every feeder above them is blocked (E2003). */
  missingPf: string[];
  /** Motor-driven equipment without its efficiency: every feeder above is blocked (E2003). */
  missingEfficiency: string[];
  /** Other blocked rows (table value, device, data missing): see their Why not sized. */
  otherBlocked: number;
  /** Rows not calculated yet or changed since the last Cable Size. */
  notRun: number;
}

const BLOCKING = new Map<string, string>(
  ERROR_CATALOGUE.filter((e) => e.effect === 'blocks').map((e) => [e.code, e.message]),
);

/** Why a row has no figures, in plain words; null when it is sized. */
function whyNotSized(found: ReturnType<typeof resultOf>, to: string): string | null {
  const r = found?.result;
  if (!r) return 'Cable Size not run yet for this item: press Cable Size.';
  if (found.outOfDate) return 'Changed since the last Cable Size: run it again.';
  if (r.status === 'awaiting-load') {
    return `No load entered on ${to} or below it: nothing to size (enter its loads).`;
  }
  if (r.status !== 'blocked') return null;
  // Design current not worked out: the engine's own reason names what is missing.
  const ib = [...r.trace].reverse().find((t) => t.step === 'Ib');
  if (r.values.ibA === null && ib) return ib.detail;
  const codes = r.errors.filter((c) => BLOCKING.has(c));
  return codes.length
    ? codes.map((c) => `${BLOCKING.get(c)!.replace(/\.$/, '')} (${c})`).join('; ')
    : 'Blocked: see the codes and the calculation trace.';
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
    // Not columns: the default logic's type when the engineer chose another (A-34, W2004).
    'device:default': r.device?.defaultType ?? null,
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
    eccRuns: r.size?.eccMm2 ? (r.size.runs ?? null) : null,
    vdrMvAm: c?.vdrMvAm ?? null,
    vdxMvAm: c?.vdxMvAm ?? null,
    vuMvAm: c?.vuMvAm ?? null,
    rkMohm: c?.rkMohm ?? null,
    xkMohm: c?.xkMohm ?? null,
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
    // The check's own detail (failing values, reason), shown on hover - not a column.
    ...Object.fromEntries(CHECKS.map((code) => [`${code}:detail`, r.checks[code]?.detail ?? null])),
    sizedBy: r.sizedBy,
    status: found.outOfDate ? 'Out of date' : STATUS[r.status],
    errors: r.errors.join(', ') || null,
  };
}

/**
 * Voltage and phases from the load itself when the engine did not get as far as Ib: the phases
 * carrying demand, else (equipment whose input kW is unknown) the phases of the equipment below.
 */
function phasesBelow(
  p: Project,
  id: string,
  summaries: Map<string, LoadSummary>,
  seen = new Set<string>(),
): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const d = summaries.get(id)?.demand;
  const n = d ? [d.L1, d.L2, d.L3].filter((kw) => kw > 0).length : 0;
  if (n > 0) return n === 1 ? 1 : 3;
  let most = 0;
  for (const e of p.model.elements) {
    if (e.kind === 'equipment' && e.fedFromId === id && e.kw) {
      most = Math.max(most, e.phases === '3P' ? 3 : 1);
    }
  }
  for (const c of p.model.cables) {
    if (c.from.elementId === id)
      most = Math.max(most, phasesBelow(p, c.to.elementId, summaries, seen));
  }
  for (const r of p.model.risers) {
    if (r.fedFromId === id) {
      for (const b of r.feeds) most = Math.max(most, phasesBelow(p, b, summaries, seen));
    }
  }
  return most;
}

function supplyOf(
  p: Project,
  id: string,
  summaries: Map<string, LoadSummary>,
): Pick<CalcRow, 'voltageV' | 'phases'> {
  const n = phasesBelow(p, id, summaries);
  if (n === 0) return { voltageV: null, phases: null };
  return n === 1 ? { voltageV: 230, phases: 1 } : { voltageV: 400, phases: 3 };
}

const n = (v: number, d: number) => v.toFixed(d);

/**
 * The working of a cable row's voltage drop and short circuit, with its own numbers (user request
 * 27 Nov 2026): unit drop (Vu = VDr cos + VDx sin, or the VU table below 25 mm²), the feeder's drop
 * and Ik"max at its breaker from the R / X totals, with this cable's Rk / Xk.
 */
function formulas(cable: Cable, r: ElementResult | undefined): CalcRow {
  const c = r?.calc;
  const size = r?.size;
  const out: CalcRow = { vuFormula: null, vdFormula: null, scFormula: null };
  if (!c || !size || cable.feederType === 'busbar') return out;
  const phases = c.ibCase === 'single-phase' ? 1 : 3;
  if (c.vuMvAm !== null && c.vuMvAm !== undefined) {
    if (typeof c.vdrMvAm === 'number' && typeof c.vdxMvAm === 'number' && c.pf) {
      const sin = Math.sin(Math.acos(c.pf));
      out.vuFormula = `Vu = VDr x cos phi + VDx x sin phi = ${n(c.vdrMvAm, 3)} x ${n(c.pf, 3)} + ${n(c.vdxMvAm, 3)} x ${n(sin, 3)} = ${n(c.vuMvAm, 3)} mV/A/m`;
    } else if (size.sizeMm2 < 25) {
      out.vuFormula = `Vu = ${n(c.vuMvAm, 3)} mV/A/m from the VU table (${size.sizeMm2} mm², ${phases}-phase): below 25 mm² the tables give no VDr / VDx (CableSizer)`;
    } else {
      // 25 mm² and above Vu is always VDr cos + VDx sin; a result from before 26 Nov 2026 did not
      // keep VDr / VDx - the next Cable Size run fills them in.
      out.vuFormula = `Vu = VDr x cos phi + VDx x sin phi = ${n(c.vuMvAm, 3)} mV/A/m (${size.sizeMm2} mm²): VDr / VDx were not kept by this older Cable Size result - press Cable Size (or Download) to show them`;
    }
    const ib = r.values.ibA;
    if (ib !== null && typeof c.vdOwnV === 'number') {
      const v = phases === 1 ? 230 : 400;
      // Star-delta (A-36): 2 cables, each carrying Ib / 3 - the current is divided by 3.
      const share = c.starDelta ? size.runs * 1.5 : size.runs;
      out.vdFormula = c.starDelta
        ? `Vd = Vu x (Ib / 3) x L / 1000 per cable (star-delta, ${size.runs} cables) = ${n(c.vuMvAm, 3)} x ${n(ib, 2)} x ${n(size.lengthM, 2)} / (1000 x ${n(share, 1)}) = ${n(c.vdOwnV, 2)} V = ${n((c.vdOwnV / v) * 100, 2)} % of ${v} V`
        : `Vd = Vu x Ib x L / (1000 x N) = ${n(c.vuMvAm, 3)} x ${n(ib, 2)} x ${n(size.lengthM, 2)} / (1000 x ${size.runs}) = ${n(c.vdOwnV, 2)} V = ${n((c.vdOwnV / v) * 100, 2)} % of ${v} V`;
    }
  }
  const parts: string[] = [];
  if (typeof c.rktMohm === 'number' && typeof c.xktMohm === 'number' && r.values.ikMaxKa) {
    const z = Math.hypot(c.rktMohm, c.xktMohm);
    parts.push(
      `Ik"max at the breaker = 400 / (1.732 x sqrt(Rkt² + Xkt²)) = 400 / (1.732 x sqrt(${n(c.rktMohm, 3)}² + ${n(c.xktMohm, 3)}²)) = 400 / (1.732 x ${n(z, 3)}) = ${n(r.values.ikMaxKa, 2)} kA (Rkt / Xkt = totals from the source, mOhm)`,
    );
  }
  if (typeof c.rkMohm === 'number' && typeof c.xkMohm === 'number') {
    const rho = cable.construction.conductor === 'Al' ? 30.34 : 18.32;
    const xm = size.sizeMm2 < 120 ? 0.1 : 0.09;
    parts.push(
      `This cable (added for the boards below): Rk = ${rho} x L / (A x N) = ${rho} x ${n(size.lengthM, 2)} / (${size.sizeMm2} x ${size.runs}) = ${n(c.rkMohm, 3)} mOhm; Xk = ${xm} x L / N = ${xm} x ${n(size.lengthM, 2)} / ${size.runs} = ${n(c.xkMohm, 3)} mOhm`,
    );
  }
  out.scFormula = parts.length ? parts.join('. ') : null;
  return out;
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
  const to = byId.get(cable.to.elementId)?.tag ?? '-';
  const load = summaries.get(cable.to.elementId);
  const supply = supplyOf(p, cable.to.elementId, summaries);
  return {
    // Not columns: the feeder and the engineer's breaker choice, for the dropdown (A-34).
    cableId: cable.id,
    'device:chosen': cable.breakerType ?? null,
    ref: cable.tag,
    kind: busbar ? 'Busbar feeder' : 'Cable',
    from: byId.get(cable.from.elementId)?.tag ?? '-',
    to,
    ...fig,
    voltageV: fig.voltageV ?? supply.voltageV ?? null,
    phases: fig.phases ?? supply.phases ?? null,
    loadKw: fig.loadKw ?? load?.maxDemandKw ?? null,
    pf: fig.pf ?? load?.pf ?? null,
    note: whyNotSized(found, to),
    method: busbar ? null : METHODS[k.method],
    construction: busbar ? 'Busbar TPN+E' : construction(k),
    trays: busbar ? null : k.trays,
    grouped: busbar ? null : k.groupedCircuits,
    spacing: busbar ? null : k.separation,
    depthM: busbar ? null : k.depthM,
    lengthM: found?.result.size?.lengthM ?? found?.result.calc?.lengthM ?? null,
    ...formulas(cable, found?.result),
  };
}

function riserRow(p: Project, index: number, byId: Map<string, Element>, key: string): CalcRow {
  const r = p.model.risers[index]!;
  const found = resultOf(p, r.id, key);
  const fig = figures(found);
  return {
    note: whyNotSized(found, `Riser ${index + 1}`),
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
  // Causes of the rows without figures, traced to the components to fix.
  const notSized: NotSized = {
    awaitingLoad: [],
    missingPf: [],
    missingEfficiency: [],
    otherBlocked: 0,
    notRun: 0,
  };
  const add = (list: string[], tags: string[]) =>
    tags.forEach((t) => list.includes(t) || list.push(t));
  for (const c of p.model.cables) {
    const found = resultOf(p, c.id, key);
    const s = summaries.get(c.to.elementId);
    if (!found || found.outOfDate) notSized.notRun++;
    else if (found.result.status === 'awaiting-load')
      add(notSized.awaitingLoad, [byId.get(c.to.elementId)?.tag ?? '-']);
    else if (found.result.status === 'blocked') {
      const traced = (s?.missingPf.length ?? 0) + (s?.incomplete.length ?? 0) > 0;
      if (found.result.values.ibA === null && traced) {
        add(notSized.missingPf, s!.missingPf);
        add(notSized.missingEfficiency, s!.incomplete);
      } else notSized.otherBlocked++;
    }
  }
  return {
    project: p.details.name,
    rulePack: `${p.rulePackId ?? '-'} v${p.rulePackVersion ?? '-'}`,
    rows,
    sizesPending: rows.some((r) => r.status === 'Out of date' || r.status === 'Not calculated'),
    notSized,
  };
}
