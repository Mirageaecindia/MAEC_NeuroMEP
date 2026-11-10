import {
  loadSummaries,
  pfcRating,
  suppliedIn,
  type Element,
  type ElementKind,
  type Project,
  type ProvisionalReason,
} from '@neuromep/shared';
import {
  breakerTypeFor,
  getRulePack,
  loadPowerFactors,
  standardRating,
  type BreakerType,
} from '@neuromep/rulepacks';

/**
 * Pass 1 and step 3 of the calculation order (10.2): loads per phase with demand factors
 * (#TASK-19, shared `loadSummaries`, A-15 interim), design current Ib of every feeder from the
 * demand it carries (D-06, 10.4) and its protective device (#TASK-20, 10.5).
 * Missing data never becomes 0 or 1 (V-14): the feeder is blocked with its error code.
 */

const SQRT3 = Math.sqrt(3);
const V_LINE = 400;
const V_PHASE = 230;
/** Capacitor bank current factor (V-08: 1.5 x Q / (sqrt3 V), minimum 1.43, IEC 60831). */
export const PFC_CURRENT_FACTOR = 1.5;
/** IEC 60947-2 tolerance of the magnetic threshold: checks use Ia = 1.2 x Im (V-09). */
export const IA_FACTOR = 1.2;

const SOURCES = new Set<ElementKind>(['transformer', 'generator', 'ups']);
const MAIN_PANELS = new Set<ElementKind>(['lv-panel', 'mdb', 'emdb', 'acb-panel']);

export type IbCase = 'three-phase' | 'single-phase' | 'unbalanced' | 'motor';

export interface DeviceSelection {
  ratingA: number;
  type: BreakerType;
  poles: '1P' | '3P' | '4P';
  /** Type limit still interim (OI-03, e.g. MCB up to 63 A). */
  interim: boolean;
  /** Magnetic threshold and trip current: from the breaker catalogue (OI-03), null until then. */
  imA: number | null;
  iaA: number | null;
}

export interface FeederDesign {
  cableId: string;
  /** The component the feeder supplies. */
  toId: string;
  demandKw: { L1: number; L2: number; L3: number };
  pf: number | null;
  ibA: number | null;
  ibCase: IbCase | null;
  /** Neutral current of an unbalanced load (10.4, V-05); 0 when balanced. */
  neutralA: number | null;
  device: DeviceSelection | null;
  status: 'provisional' | 'awaiting-load' | 'blocked';
  provisionalReasons: ProvisionalReason[];
  /** Error codes (Appendix D): E2003 / E2001 block, E1901 warns. */
  errors: string[];
  trace: { step: string; detail: string }[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** |IL1 + a IL2 + a² IL3| for phase currents at the same power factor. */
function neutralCurrent(a: number, b: number, c: number): number {
  return Math.sqrt(Math.max(0, a * a + b * b + c * c - a * b - b * c - c * a));
}

function poles(from: Element | undefined, to: Element, phases: number): DeviceSelection['poles'] {
  if ((from && SOURCES.has(from.kind)) || MAIN_PANELS.has(to.kind)) return '4P';
  return phases === 1 ? '1P' : '3P';
}

/** Design current and device of every feeder (cable or busbar) in the project. */
export function designFeeders(project: Project): FeederDesign[] {
  if (!project.rulePackId || !project.rulePackVersion) {
    throw new Error('The project has no rule pack; Cable Size needs one (Page 1 region).');
  }
  const pack = getRulePack(project.rulePackId, project.rulePackVersion);
  // Per load type and the default (12.2): the Technical Lead's override, else the rule-pack value.
  const pfs = loadPowerFactors(project, pack);
  const summaries = loadSummaries(project, pfs);
  // PFC target power factor (12.2, 10.15): the Technical Lead's override, else the rule pack.
  const targetOverride = project.calculation.defaultOverrides.targetPowerFactor;
  const targetValue = pack.calculationDefaults.find((d) => d.key === 'targetPowerFactor')?.value;
  const targetPf =
    typeof targetOverride === 'number'
      ? targetOverride
      : typeof targetValue === 'number'
        ? targetValue
        : null;
  const supplied = new Set([
    ...suppliedIn(project.model, 'normal'),
    ...suppliedIn(project.model, 'standby'),
  ]);
  const byId = new Map(project.model.elements.map((e) => [e.id, e]));

  return project.model.cables.flatMap((cable): FeederDesign[] => {
    const to = byId.get(cable.to.elementId);
    const s = to && summaries.get(to.id);
    if (!to || !s) return [];
    const from = byId.get(cable.from.elementId);
    const trace: FeederDesign['trace'] = [];
    const errors: string[] = [];
    // CableSizer tables are the working tables (decision 2 Nov 2026, amends V-12): not a reason.
    const reasons: ProvisionalReason[] = [];
    if (!supplied.has(to.id)) reasons.unshift('upstream-not-connected');
    if (s.tbcFactors.length || s.tbcCategories.length) {
      reasons.push('demand-factors-tbc');
      errors.push('E1901');
      trace.push({
        step: 'Demand',
        detail: `TBC factors counted as 1.0: ${[...s.tbcFactors, ...s.tbcCategories].join(', ')}`,
      });
    }
    const d = s.demand;
    const phases = [d.L1, d.L2, d.L3].filter((p) => p > 0).length;
    const base = {
      cableId: cable.id,
      toId: to.id,
      demandKw: d,
      pf: s.pf,
      provisionalReasons: reasons,
      errors,
      trace,
    };
    trace.push({
      step: 'Load',
      detail: `Demand ${r1(d.L1)} / ${r1(d.L2)} / ${r1(d.L3)} kW (L1 / L2 / L3), pf ${s.pf ?? '-'}`,
    });

    const blocked = (detail: string): FeederDesign => {
      errors.unshift('E2003');
      trace.push({ step: 'Ib', detail });
      return { ...base, ibA: null, ibCase: null, neutralA: null, device: null, status: 'blocked' };
    };
    /** 10.5: In = lowest standard rating >= Ib; type by rating; Im / Ia from the catalogue (OI-03). */
    function withDevice(
      ibA: number,
      ibCase: IbCase,
      neutralA: number,
      phases: number,
    ): FeederDesign {
      const ratingA = standardRating(pack.devices, ibA);
      if (ratingA === null) {
        errors.unshift('E2001');
        trace.push({ step: 'Device', detail: `No standard rating at or above ${r1(ibA)} A.` });
        return { ...base, ibA, ibCase, neutralA, device: null, status: 'blocked' };
      }
      const type = breakerTypeFor(pack.devices, ratingA)!;
      const device: DeviceSelection = {
        ratingA,
        type: type.type,
        poles: poles(from, to!, phases),
        interim: type.interim,
        imA: null,
        iaA: null,
      };
      trace.push({
        step: 'Device',
        detail: `In = ${ratingA} A ${device.type} ${device.poles}${device.interim ? ' (type limit interim, OI-03)' : ''}; Im / Ia need the breaker catalogue (OI-03)`,
      });
      return { ...base, ibA, ibCase, neutralA, device, status: 'provisional' };
    }
    // 10.4 / 10.15: the design current, by connection type.
    let ibA: number;
    let ibCase: IbCase;
    let neutralA: number;
    if (to.kind === 'pfc-bank') {
      // A PFC bank (user request 10 Nov 2026): its kVAr from the demand of the panel feeding it.
      const rating = pfcRating(project, to.id, pfs, targetPf);
      const panel = rating.panelId ? (byId.get(rating.panelId)?.tag ?? '?') : '?';
      if (rating.missingPf.length) {
        return [
          blocked(
            `Power factor missing on ${rating.missingPf.join(', ')}: the PFC rating of ${to.tag} needs it (10.15).`,
          ),
        ];
      }
      if (rating.kvar === null) return [blocked('Target power factor (PFC) not set (12.2).')];
      trace.push({
        step: 'PFC',
        detail: `Qc = ${r1(rating.kvar)} kVAr: demand of ${panel} corrected to pf ${targetPf} - ${rating.rows
          .map((r) => `${r.category} ${r1(r.demandKw)} kW / ${r1(r.kvar)} kVAr`)
          .join(', ')} (10.15)`,
      });
      if (rating.kvar <= 0) {
        return [
          { ...base, ibA: 0, ibCase: null, neutralA: null, device: null, status: 'awaiting-load' },
        ];
      }
      ibCase = 'three-phase';
      ibA = (PFC_CURRENT_FACTOR * rating.kvar * 1000) / (SQRT3 * V_LINE);
      neutralA = 0;
      trace.push({
        step: 'Ib',
        detail: `capacitor bank: Ib = ${PFC_CURRENT_FACTOR} x ${r1(rating.kvar)} kVAr x 1000 / (sqrt3 x ${V_LINE}) = ${r1(ibA)} A (V-08)${to.detuned ? '; detuned bank: the manufacturer factor is awaited (OI-20), 1.5 used' : ''}; voltage drop worked out at the default load power factor (a capacitor current raises the voltage: conservative)`,
      });
      return [withDevice(ibA, ibCase, neutralA, 3)];
    }
    if (s.incomplete.length) {
      return [
        blocked(
          `Efficiency missing on motor-driven equipment ${s.incomplete.join(', ')}: input kW = rated kW / efficiency.`,
        ),
      ];
    }
    if (phases === 0) {
      return [
        { ...base, ibA: 0, ibCase: null, neutralA: null, device: null, status: 'awaiting-load' },
      ];
    }
    if (s.pf === null) return [blocked('Power factor missing on the load.')];

    const total = d.L1 + d.L2 + d.L3;
    if (to.kind === 'motor') {
      const eff = to.efficiency;
      if (eff === null)
        return [blocked('Motor efficiency missing; the default by motor class is open (OI-30).')];
      ibCase = 'motor';
      ibA =
        phases === 1
          ? (total * 1000) / (V_PHASE * s.pf * eff)
          : (total * 1000) / (SQRT3 * V_LINE * s.pf * eff);
    } else if (phases === 3 && d.L1 === d.L2 && d.L2 === d.L3) {
      ibCase = 'three-phase';
      ibA = (total * 1000) / (SQRT3 * V_LINE * s.pf);
    } else {
      // Single-phase, or unbalanced: the largest phase current (V-05).
      ibCase = phases === 1 ? 'single-phase' : 'unbalanced';
      ibA = (Math.max(d.L1, d.L2, d.L3) * 1000) / (V_PHASE * s.pf);
    }
    const phaseA = [d.L1, d.L2, d.L3].map((p) => (p * 1000) / (V_PHASE * s.pf!));
    neutralA = ibCase === 'motor' ? 0 : neutralCurrent(phaseA[0]!, phaseA[1]!, phaseA[2]!);
    trace.push({ step: 'Ib', detail: `${ibCase}: Ib = ${r1(ibA)} A, neutral ${r1(neutralA)} A` });
    return [withDevice(ibA, ibCase, neutralA, phases)];
  });
}
