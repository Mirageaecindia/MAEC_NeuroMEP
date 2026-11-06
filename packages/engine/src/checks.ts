import { cableLength, loadSummaries, type ElementKind, type Project } from '@neuromep/shared';
import { dewaMinimum, getRulePack, loadPowerFactors, standardRating } from '@neuromep/rulepacks';
import { busbarChoices, busbarDropPct, distributionFactor, type BusbarChoice } from './busbar.js';
import { cableRating, voltageDrop, type Blocked, type Drop, type Rating } from './capacity.js';
import { designFeeders, type FeederDesign } from './design.js';

/**
 * C1 and C2 for every feeder (10.6, 10.7) at a given size: the locked size, else a size chosen by
 * the sizing loop (sizing.ts), else the starting size - the DEWA minimum for the breaker (10.2
 * step 4, C6) - with the voltage drop accumulated top-down from the source.
 */

export interface Sizes {
  sizeMm2: number;
  runs: number;
}

export type CheckState = 'pass' | 'fail' | 'blocked' | 'not-run';

export interface FeederCheck extends FeederDesign {
  size: (Sizes & { from: 'locked' | 'dewa-minimum' | 'sized' }) | null;
  /** Voltage drop up to the feeder's source board (worst incoming path); null when unknown. */
  vdUpstreamPct: number | null;
  lengthM: number;
  rating: Rating | null;
  drop: Drop | null;
  /** Cumulative voltage drop at the end of this feeder; null when the path upstream is unknown. */
  vdTotalPct: number | null;
  vdLimitPct: number | null;
  c1: CheckState;
  c2: CheckState;
  warnings: string[];
  /** A busbar feeder: the chosen rating of the project's busbar maker (3 Nov 2026). */
  busbar: BusbarChoice | null;
}

/** A riser (Building tab): a busbar carrying the demand of the boards on its tap-offs. */
export interface RiserCheck {
  riserId: string;
  /** 1-based number as shown in the Building tab. */
  index: number;
  ibA: number | null;
  inA: number | null;
  busbar: BusbarChoice | null;
  /** Load distribution factor (n + 1) / 2n for n tap-offs. */
  k: number;
  lengthM: number | null;
  vdPct: number | null;
  /** Drop at the tap-offs (upstream + riser); null when not calculable. */
  vdTotalPct: number | null;
  vdLimitPct: number | null;
  c2: CheckState;
  notes: string[];
  /** Tap-off box of each board on the riser (Section 14): current and breaker rating. */
  tapOffs: { boardId: string; ibA: number | null; inA: number | null }[];
}

const SOURCES = new Set<ElementKind>(['transformer', 'generator', 'ups']);

/** Ib of a demand (10.4): balanced three-phase on 400 V, else the largest phase on 230 V. */
function phaseCurrent(d: { L1: number; L2: number; L3: number }, pf: number | null): number | null {
  const p = d.L1 + d.L2 + d.L3;
  if (!pf || p <= 0) return null;
  return d.L1 === d.L2 && d.L2 === d.L3
    ? (p * 1000) / (Math.sqrt(3) * 400 * pf)
    : (Math.max(d.L1, d.L2, d.L3) * 1000) / (230 * pf);
}

/** Rule-pack limit key for the board a feeder supplies (10.7, Ti sheet). */
export function limitKey(kind: ElementKind): string {
  if (['lv-panel', 'mdb', 'emdb', 'acb-panel'].includes(kind)) return 'MDB';
  if (['smdb', 'esmdb'].includes(kind)) return 'SMDB';
  if (['mcc', 'emcc'].includes(kind)) return 'MCC';
  if (kind === 'db') return 'DB';
  if (kind === 'motor') return 'Motor';
  return 'FinalCircuits';
}

export function checkFeeders(
  project: Project,
  sized: ReadonlyMap<string, Sizes> = new Map(),
): FeederCheck[] {
  return checkNetworkFeeders(project, sized).feeders;
}

/** Feeders and risers together: risers sit between the feeders above and below them. */
export function checkNetworkFeeders(
  project: Project,
  sized: ReadonlyMap<string, Sizes> = new Map(),
): { feeders: FeederCheck[]; risers: RiserCheck[] } {
  const pack = getRulePack(project.rulePackId!, project.rulePackVersion!);
  const defaults = new Map(pack.calculationDefaults.map((d) => [d.key, d]));
  const num = (key: string) => {
    const o = project.calculation.defaultOverrides[key];
    if (typeof o === 'number') return o;
    const d = defaults.get(key);
    return typeof d?.value === 'number'
      ? d.value
      : typeof d?.interimDefault === 'number'
        ? d.interimDefault
        : null;
  };
  // Length: measured route + the fixed addition per cable (5 m) + any percentage (12.2, 3 Nov 2026).
  const length = {
    allowancePct: num('cableLengthAllowancePct') ?? 0,
    additionM: num('cableLengthAdditionM'),
  };
  const site = {
    airC: project.site.ambientAirC.value,
    groundC: project.site.ambientSoilC.value,
    soilResistivity: project.site.soilResistivity.value,
  };
  const elements = new Map(project.model.elements.map((e) => [e.id, e]));
  const cables = new Map(project.model.cables.map((c) => [c.id, c]));
  const designs = designFeeders(project);
  // Feeders into each component: an ATS has two (normal and standby input).
  const into = new Map<string, FeederDesign[]>();
  for (const d of designs) into.set(d.toId, [...(into.get(d.toId) ?? []), d]);

  const maker = project.calculation.busbarMaker;
  const pfDefault = num('defaultLoadPowerFactor');
  let summaries: ReturnType<typeof loadSummaries> | null = null;
  const summaryOf = (id: string) =>
    (summaries ??= loadSummaries(project, loadPowerFactors(project, pack))).get(id);

  /** Drop up to a board: 0 at a source, the worst feeder into it, else through its riser. */
  const upstreamOf = (boardId: string | undefined): number | null => {
    const board = boardId ? elements.get(boardId) : undefined;
    if (!board) return null;
    if (SOURCES.has(board.kind)) return 0;
    const known = (into.get(board.id) ?? [])
      .map((u) => check(u).vdTotalPct)
      .filter((v): v is number => v !== null);
    if (known.length) return Math.max(...known);
    const r = project.model.risers.findIndex((x) => x.feeds.includes(board.id));
    return r >= 0 ? riser(r).vdTotalPct : null;
  };

  const riserChecks = new Map<number, RiserCheck>();
  const riser = (i: number): RiserCheck => {
    const done = riserChecks.get(i);
    if (done) return done;
    const r = project.model.risers[i]!;
    const limit = num('voltageDropLimitPct.Busduct');
    const result: RiserCheck = {
      riserId: r.id,
      index: i + 1,
      ibA: null,
      inA: null,
      busbar: null,
      k: distributionFactor(r.feeds.length),
      lengthM: r.lengthM,
      vdPct: null,
      vdTotalPct: null,
      vdLimitPct: limit,
      c2: 'not-run',
      notes: [],
      tapOffs: [],
    };
    riserChecks.set(i, result);
    // Every input still missing, in words the engineer can act on (shown under the Cost).
    const n = i + 1;
    const missing: string[] = [];
    if (!r.fedFromId) {
      missing.push(
        `Riser ${n} has no source: click the riser in the diagram to choose the transformer, LV panel or MDB that feeds it.`,
      );
    }
    if (r.feeds.length === 0) {
      missing.push(
        `Riser ${n} feeds no boards: click a board on a floor to connect it to a tap-off of this riser.`,
      );
    }
    if (!r.lengthM) missing.push(`Riser ${n} has no length: enter it in Riser Design.`);
    if (!maker) {
      missing.push(
        'No busbar manufacturer chosen: choose it on Import File (Busbar Manufacturer).',
      );
    }
    if (!r.fedFromId || r.feeds.length === 0) {
      result.notes.push(...missing);
      return result;
    }
    // Tap-off box per board: In = standard rating >= the board's Ib (10.4, 10.5).
    result.tapOffs = r.feeds.map((boardId) => {
      const s = summaryOf(boardId);
      const ib = s ? phaseCurrent(s.demand, s.pf ?? pfDefault) : null;
      return { boardId, ibA: ib, inA: ib === null ? null : standardRating(pack.devices, ib) };
    });
    // Current: the demand of the boards on its tap-offs, largest phase (10.4).
    const subs = r.feeds.map((id) => summaryOf(id)).filter((x) => !!x);
    const d = subs.reduce(
      (t, x) => ({ L1: t.L1 + x.demand.L1, L2: t.L2 + x.demand.L2, L3: t.L3 + x.demand.L3 }),
      { L1: 0, L2: 0, L3: 0 },
    );
    const p = d.L1 + d.L2 + d.L3;
    const q = subs.reduce((t, x) => t + (x.pf ? x.maxDemandKw * Math.tan(Math.acos(x.pf)) : 0), 0);
    // A loaded board without a power factor gives the riser none either - never assumed (V-14).
    const pfMissing = subs.some((x) => x.maxDemandKw > 0 && !x.pf);
    const pf = pfMissing ? null : p > 0 ? p / Math.hypot(p, q) : pfDefault;
    const ib = pf ? phaseCurrent(d, pf) : null;
    if (ib === null) {
      const tags = r.feeds.map((id) => elements.get(id)?.tag ?? id).join(', ');
      missing.unshift(
        p > 0
          ? `No power factor for the load on Riser ${n} (E2003).`
          : `No load reaches Riser ${n}: enter the loads of the DBs fed from ${tags} in Floor Setup.`,
      );
      result.notes.push(...missing);
      return result;
    }
    result.ibA = ib;
    result.inA = standardRating(pack.devices, ib);
    if (missing.length || !maker || !r.lengthM) {
      result.notes.push(...missing);
      return result;
    }
    const options = busbarChoices(pack, maker).filter((b) => b.ratingA >= (result.inA ?? Infinity));
    if (!options.length) {
      result.notes.push(
        `No ${maker} busbar rating at or above ${result.inA ?? '-'} A in the data.`,
      );
      return result;
    }
    const up = upstreamOf(r.fedFromId) ?? 0;
    const drop = (b: BusbarChoice) => busbarDropPct(b, result.ibA!, pf!, r.lengthM!, result.k);
    const pick = options.find((b) => limit === null || up + drop(b) <= limit) ?? options[0]!;
    result.busbar = pick;
    result.vdPct = drop(pick);
    result.vdTotalPct = up + result.vdPct;
    result.c2 = limit === null ? 'not-run' : result.vdTotalPct <= limit ? 'pass' : 'fail';
    result.notes.push(
      `${pick.ratingA} A ${maker} busbar, ${r.lengthM} m, k ${result.k.toFixed(3)} (${r.feeds.length} tap-offs): Vd ${result.vdPct.toFixed(2)} %, total ${result.vdTotalPct.toFixed(2)} % vs ${limit ?? '-'} %`,
    );
    return result;
  };

  const checked = new Map<string, FeederCheck>();
  const check = (d: FeederDesign): FeederCheck => {
    const done = checked.get(d.cableId);
    if (done) return done;
    const cable = cables.get(d.cableId)!;
    const to = elements.get(d.toId)!;
    const from = elements.get(cable.from.elementId);
    const limit = num(`voltageDropLimitPct.${limitKey(to.kind)}`);
    const result: FeederCheck = {
      ...d,
      size: null,
      vdUpstreamPct: null,
      lengthM: cableLength(cable, length).totalM,
      rating: null,
      drop: null,
      vdTotalPct: null,
      vdLimitPct: limit,
      c1: 'not-run',
      c2: 'not-run',
      warnings: [],
      busbar: null,
      errors: [...d.errors],
      trace: [...d.trace],
    };
    checked.set(d.cableId, result);
    const block = (b: Blocked, which: 'c1' | 'c2') => {
      result[which] = 'blocked';
      if (!result.errors.includes(b.code)) result.errors.push(b.code);
      result.status = 'blocked';
      result.trace.push({ step: which.toUpperCase(), detail: b.detail });
    };

    if (cable.feederType === 'busbar' && !maker) {
      block(
        { ok: false, code: 'E2102', detail: 'Choose the busbar manufacturer on Import File.' },
        'c1',
      );
      return result;
    } else if (
      cable.feederType === 'busbar' &&
      d.status !== 'blocked' &&
      d.ibA !== null &&
      d.device &&
      d.pf !== null
    ) {
      // Busbar feeder: the smallest rating >= In (C1), moving up if C2 needs it.
      const options = busbarChoices(pack, maker!).filter((b) => b.ratingA >= d.device!.ratingA);
      if (!options.length) {
        block(
          {
            ok: false,
            code: 'E2101',
            detail: `No ${maker} busbar rating at or above ${d.device.ratingA} A in the data.`,
          },
          'c1',
        );
        return result;
      }
      const up = upstreamOf(cable.from.elementId);
      const pct = (b: BusbarChoice) => busbarDropPct(b, d.ibA!, d.pf!, result.lengthM);
      const pick =
        options.find((b) => up === null || limit === null || up + pct(b) <= limit) ?? options[0]!;
      const vu = Math.sqrt(3) * (pick.rHotMohmM * d.pf + pick.xMohmM * Math.sin(Math.acos(d.pf)));
      result.busbar = pick;
      result.c1 = 'pass';
      result.drop = {
        vuMvAm: vu,
        vcV: (vu * d.ibA * result.lengthM) / 1000,
        vcPct: pct(pick),
      };
      result.vdUpstreamPct = up;
      if (up !== null) {
        result.vdTotalPct = up + result.drop.vcPct;
        result.c2 = limit === null ? 'not-run' : result.vdTotalPct <= limit ? 'pass' : 'fail';
      }
      result.trace.push({
        step: 'C1',
        detail: `${pick.ratingA} A ${maker} busbar (R95 ${pick.rHotMohmM.toFixed(4)}, X ${pick.xMohmM} mOhm/m) vs In ${d.device.ratingA} A: pass`,
      });
      result.trace.push({
        step: 'C2',
        detail: `Vd ${result.drop.vcPct.toFixed(2)} %, total ${result.vdTotalPct === null ? '-' : `${result.vdTotalPct.toFixed(2)} %`} vs ${limit ?? '-'} %`,
      });
      return result;
    }
    if (d.status === 'blocked' || d.ibA === null || !d.device || d.pf === null) return result;

    // Starting size: locked by the engineer, else the DEWA minimum for the breaker (C6).
    const locked = cable.locks.sizeMm2;
    const dewa = dewaMinimum(pack.devices, d.device.ratingA);
    const chosen = sized.get(d.cableId);
    result.size = locked
      ? { sizeMm2: locked, runs: cable.locks.runs ?? 1, from: 'locked' }
      : chosen
        ? { ...chosen, from: 'sized' }
        : dewa
          ? { sizeMm2: dewa.sizeMm2, runs: dewa.runs, from: 'dewa-minimum' }
          : null;
    if (!result.size) {
      block(
        { ok: false, code: 'E2101', detail: `No DEWA minimum size for ${d.device.ratingA} A.` },
        'c1',
      );
      return result;
    }
    const { sizeMm2, runs } = result.size;
    const phases = d.ibCase === 'single-phase' ? 1 : 3;

    const rating = cableRating(cable.construction, phases, sizeMm2, runs, site);
    if (!rating.ok) block(rating, 'c1');
    else {
      result.rating = rating;
      result.warnings.push(...rating.warnings);
      if (rating.warnings.length && !result.errors.includes('E2103')) result.errors.push('E2103');
      // C1 (BS 7671 433.1.1): Ib <= In <= Iz.
      result.c1 = rating.izA >= d.device.ratingA ? 'pass' : 'fail';
      result.trace.push({
        step: 'C1',
        detail: `${runs} x ${sizeMm2} mm²: It ${rating.itA} A x K1 ${rating.k1.toFixed(3)} x K2 ${rating.k2} x Kr ${rating.kr.toFixed(3)} x K3 ${rating.k3.toFixed(3)} = Iz ${rating.izA.toFixed(1)} A vs In ${d.device.ratingA} A: ${result.c1}`,
      });
      for (const n of rating.notes) result.trace.push({ step: 'C1', detail: n });
    }

    const drop = voltageDrop(
      cable.construction,
      phases,
      sizeMm2,
      runs,
      d.ibA,
      d.pf,
      result.lengthM,
    );
    if (!drop.ok) block(drop, 'c2');
    else {
      result.drop = drop;
      for (const n of drop.notes) result.trace.push({ step: 'C2', detail: n });
      // Cumulative drop: from a source it starts at 0; otherwise the worst feeder into the source
      // board (normal or standby input of an ATS). When that is unknown - a riser (busbar
      // datasheet, OI-13) or no supply path - the level above is taken at its full allowance (10.13).
      let upPct = upstreamOf(from?.id);
      if (upPct === null && from) {
        upPct = num(`voltageDropLimitPct.${limitKey(from.kind)}`);
        result.trace.push({
          step: 'C2',
          detail: `Upstream voltage drop unknown (riser busbar or no supply path): ${from.tag} taken at its full allowance ${upPct ?? '-'} % (10.13).`,
        });
      }
      result.vdUpstreamPct = upPct;
      if (upPct !== null) {
        result.vdTotalPct = upPct + drop.vcPct;
        result.c2 = limit === null ? 'not-run' : result.vdTotalPct <= limit ? 'pass' : 'fail';
      }
      result.trace.push({
        step: 'C2',
        detail: `Vu ${drop.vuMvAm.toFixed(3)} mV/A/m, ${result.lengthM.toFixed(1)} m: Vc ${drop.vcPct.toFixed(2)} %, total ${result.vdTotalPct === null ? '-' : `${result.vdTotalPct.toFixed(2)} %`} vs ${limit ?? '-'} %`,
      });
    }
    return result;
  };
  const feeders = designs.map(check);
  return { feeders, risers: project.model.risers.map((_, i) => riser(i)) };
}
