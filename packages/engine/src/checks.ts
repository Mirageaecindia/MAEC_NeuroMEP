import { cableLength, type ElementKind, type Project } from '@neuromep/shared';
import { dewaMinimum, getRulePack } from '@neuromep/rulepacks';
import { cableRating, voltageDrop, type Blocked, type Drop, type Rating } from './capacity.js';
import { designFeeders, type FeederDesign } from './design.js';

/**
 * C1 and C2 for every feeder (10.6, 10.7) at its starting size (10.2 step 4: the locked size,
 * else the DEWA minimum for the breaker, C6), with the voltage drop accumulated top-down from the
 * source. Auto-sizing (re-running with larger sizes until every check passes) is WBS 1.6.6.
 */

export type CheckState = 'pass' | 'fail' | 'blocked' | 'not-run';

export interface FeederCheck extends FeederDesign {
  size: { sizeMm2: number; runs: number; from: 'locked' | 'dewa-minimum' } | null;
  lengthM: number;
  rating: Rating | null;
  drop: Drop | null;
  /** Cumulative voltage drop at the end of this feeder; null when the path upstream is unknown. */
  vdTotalPct: number | null;
  vdLimitPct: number | null;
  c1: CheckState;
  c2: CheckState;
  warnings: string[];
}

const SOURCES = new Set<ElementKind>(['transformer', 'generator', 'ups']);

/** Rule-pack limit key for the board a feeder supplies (10.7, Ti sheet). */
function limitKey(kind: ElementKind): string {
  if (['lv-panel', 'mdb', 'emdb', 'acb-panel'].includes(kind)) return 'MDB';
  if (['smdb', 'esmdb'].includes(kind)) return 'SMDB';
  if (['mcc', 'emcc'].includes(kind)) return 'MCC';
  if (kind === 'db') return 'DB';
  if (kind === 'motor') return 'Motor';
  return 'FinalCircuits';
}

export function checkFeeders(project: Project): FeederCheck[] {
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
  const allowancePct = num('cableLengthAllowancePct') ?? 0;
  const site = {
    airC: project.site.ambientAirC.value,
    groundC: project.site.ambientSoilC.value,
    soilResistivity: project.site.soilResistivity.value,
  };
  const elements = new Map(project.model.elements.map((e) => [e.id, e]));
  const cables = new Map(project.model.cables.map((c) => [c.id, c]));
  const designs = designFeeders(project);
  const byTo = new Map(designs.map((d) => [d.toId, d]));

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
      lengthM: cableLength(cable, allowancePct).totalM,
      rating: null,
      drop: null,
      vdTotalPct: null,
      vdLimitPct: limit,
      c1: 'not-run',
      c2: 'not-run',
      warnings: [],
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

    if (cable.feederType === 'busbar') {
      block(
        {
          ok: false,
          code: 'E2102',
          detail: 'Busbar rating and R / X need the busbar datasheet (OI-13).',
        },
        'c1',
      );
      return result;
    }
    if (d.status === 'blocked' || d.ibA === null || !d.device || d.pf === null) return result;

    // Starting size: locked by the engineer, else the DEWA minimum for the breaker (C6).
    const locked = cable.locks.sizeMm2;
    const dewa = dewaMinimum(pack.devices, d.device.ratingA);
    result.size = locked
      ? { sizeMm2: locked, runs: cable.locks.runs ?? 1, from: 'locked' }
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
      // Cumulative drop: from a source it starts at 0; otherwise add the feeder into the source
      // board. A riser between them has no voltage drop yet (busbar datasheet, OI-13).
      const upstream = from && byTo.get(from.id);
      const upPct =
        from && SOURCES.has(from.kind) ? 0 : upstream ? check(upstream).vdTotalPct : null;
      if (upPct === null) {
        result.trace.push({
          step: 'C2',
          detail:
            'Upstream voltage drop unknown (riser busbar or no supply path), total not calculated.',
        });
      } else {
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
  return designs.map(check);
}
