import type { Element, Project } from '@neuromep/shared';
import { dewaMinimum, getRulePack } from '@neuromep/rulepacks';
import type { Sizes } from './checks.js';
import { checkNetwork, type DutyCheck } from './duty.js';
import { faultLevels, type FaultResult } from './shortCircuit.js';
import { tableValue } from './tables.js';

/**
 * Protection checks (#TASK-24 / #TASK-25): earth conductor size, thermal withstand C4 (10.9),
 * earth-fault loop C5 (10.10) - each only when ticked on Page 1 (D-08) - and the DEWA minimum
 * size C6 (10.11). C4 and C5 need the breaker's let-through energy, clearing time and trip
 * current from the breaker catalogue (OI-03); until then they show "Device data required"
 * (E2402) with every value the engine can work out.
 */

export type ProtectionState =
  'pass' | 'fail' | 'not-calculated' | 'not-required' | 'device-data-required';

export interface ProtectionCheck {
  state: ProtectionState;
  detail: string;
}

export interface FullCheck extends DutyCheck {
  /** ECC: separate Cu / PVC conductor, one per run (decision 3 Nov 2026), CableSizer CPC table. */
  eccMm2: number | null;
  /** Hot earth-fault loop impedance at the far end (mOhm); null when not calculable. */
  zsHotMohm: number | null;
  c4: ProtectionCheck;
  c5: ProtectionCheck;
  c6: ProtectionCheck;
}

const NOT_SELECTED: ProtectionCheck = {
  state: 'not-calculated',
  detail: 'Not calculated - not selected on Page 1',
};
const U0 = 230;
/** Distribution circuits must disconnect within 5 s (10.10; all Phase 1 feeders). */
const DISCONNECT_S = 5;

const phaseIns = (ins: string) => (ins === 'PVC' ? 'PVC' : 'XLPE');

/** Loop impedance per metre of one run, hot (10.10, V-25): Rc + (Recc // Ra), Xc + Xp. */
function loopPerMetre(
  f: DutyCheck,
  c: Project['model']['cables'][number]['construction'],
  eccMm2: number,
): number | string {
  const size = f.size!.sizeMm2;
  const rc = tableValue('Rs', { size });
  const recc = tableValue('Rs', { size: eccMm2 });
  if (!rc.found) return rc.detail;
  if (!recc.found) return recc.detail;
  const kPhase = tableValue('FactorR', { INS: phaseIns(c.insulation) });
  const kEcc = tableValue('FactorR', { INS: 'PVC' });
  const ra = tableValue('Ra', {
    MAT: 'CU',
    INS: phaseIns(c.insulation),
    ARM: c.armour === 'none' ? 'NO' : c.armour,
    CORE: c.cores,
    size,
  });
  const x = tableValue('X', {
    MAT: 'CU',
    CORE: c.cores,
    INS: phaseIns(c.insulation),
    ARM: c.armour === 'none' ? 'NO' : c.armour,
    size,
  });
  if (!kPhase.found || !kEcc.found) return 'Resistance factor missing.';
  if (!ra.found) return ra.detail;
  if (!x.found) return x.detail;
  const kArm = tableValue('FactorRa', { INS: phaseIns(c.insulation), ARM: c.armour });
  const raHot = ra.value * (kArm.found ? kArm.value : 1);
  const reccHot = recc.value * kEcc.value;
  const rp = raHot > 0 ? (reccHot * raHot) / (reccHot + raHot) : reccHot;
  return Math.hypot(rc.value * kPhase.value + rp, x.value);
}

/** C1 - C3, C7 (checkNetwork), then the earth conductor and C4 - C6 on every feeder. */
export function checkAll(project: Project, sized?: ReadonlyMap<string, Sizes>): FullCheck[] {
  const pack = getRulePack(project.rulePackId!, project.rulePackVersion!);
  const ticked = project.calculation.checks;
  const duties = checkNetwork(project, sized);
  const elements = new Map(project.model.elements.map((e) => [e.id, e]));
  const cables = new Map(project.model.cables.map((c) => [c.id, c]));
  const byTo = new Map(duties.map((d) => [d.toId, d]));
  // Source loop impedance (mOhm) at each transformer / generator, from the fault calculation.
  const sources = new Map<string, number>();
  for (const s of ['normal', 'standby'] as const) {
    const sizes = new Map(duties.filter((d) => d.size).map((d) => [d.cableId, d.size!]));
    const levels: Map<string, FaultResult> = faultLevels(project, s, sizes, new Map());
    for (const [id, r] of levels) {
      const e = elements.get(id);
      if (r.ok && e && (e.kind === 'transformer' || e.kind === 'generator')) {
        sources.set(id, Math.hypot(r.rMax, r.xMax));
      }
    }
  }

  const done = new Map<string, FullCheck>();
  const check = (d: DutyCheck): FullCheck => {
    const seen = done.get(d.cableId);
    if (seen) return seen;
    const cable = cables.get(d.cableId)!;
    const c = cable.construction;
    const from = elements.get(cable.from.elementId);
    const to = elements.get(d.toId) as Element;
    const result: FullCheck = {
      ...d,
      errors: [...d.errors],
      trace: [...d.trace],
      eccMm2: null,
      zsHotMohm: null,
      c4: ticked.letThroughEnergy
        ? { state: 'not-calculated', detail: 'No size yet.' }
        : NOT_SELECTED,
      c5: ticked.earthFaultLoopImpedance
        ? { state: 'not-calculated', detail: 'No size yet.' }
        : NOT_SELECTED,
      c6: { state: 'not-calculated', detail: 'No size yet.' },
    };
    done.set(d.cableId, result);
    if (!d.size || !d.device || cable.feederType === 'busbar') return result;
    const { sizeMm2, runs } = d.size;

    // C6 (10.11): installed size x runs >= the DEWA minimum for the breaker.
    const dewa = dewaMinimum(pack.devices, d.device.ratingA);
    result.c6 = dewa
      ? {
          state: sizeMm2 * runs >= dewa.sizeMm2 * dewa.runs ? 'pass' : 'fail',
          detail: `${runs} x ${sizeMm2} mm² vs DEWA minimum ${dewa.runs} x ${dewa.sizeMm2} mm² for ${d.device.ratingA} A${dewa.interim ? ' (next table entry, interim)' : ''}`,
        }
      : { state: 'not-calculated', detail: `No DEWA minimum above ${d.device.ratingA} A.` };

    // Fire-rated cable has 90 deg C XLPE-type insulation (FP600): its XLPE data applies.
    if (c.conductor !== 'Cu') {
      const why = 'Earth conductor and loop tables cover copper cables only.';
      if (ticked.letThroughEnergy) result.c4 = { state: 'not-calculated', detail: why };
      if (ticked.earthFaultLoopImpedance) result.c5 = { state: 'not-calculated', detail: why };
      return result;
    }
    const ecc = tableValue('CPC', {
      size: sizeMm2,
      PHCON: 'CU',
      PHINS: phaseIns(c.insulation),
      CPCINS: 'PVC',
    });
    if (!ecc.found) {
      // V-14: no earth conductor from the table is never a pass - the cable is blocked (found by
      // the engineer cross-check pack, WBS 1.7.5: the CPC table skips 400 mm² Cu/XLPE with PVC).
      result.trace.push({ step: 'ECC', detail: ecc.detail });
      if (!result.errors.includes('E2101')) result.errors.push('E2101');
      result.status = 'blocked';
      const why = `No earth conductor size: ${ecc.detail}`;
      if (ticked.letThroughEnergy) result.c4 = { state: 'not-calculated', detail: why };
      if (ticked.earthFaultLoopImpedance) result.c5 = { state: 'not-calculated', detail: why };
      return result;
    }
    result.eccMm2 = ecc.value;
    result.trace.push({
      step: 'ECC',
      detail: `${runs} x ${ecc.value} mm² Cu/PVC (CPC table for ${sizeMm2} mm²)`,
    });

    // C4 (10.9): the cable withstands k²S² (A²s); the device energy / time needs the catalogue.
    if (ticked.letThroughEnergy) {
      const k = tableValue('FactorK', { size: sizeMm2, CON: 'CU', INS: phaseIns(c.insulation) });
      const kE = tableValue('FactorK', { size: ecc.value, CON: 'CU', INS: 'PVC' });
      if (k.found && kE.found && d.faultAtBreaker) {
        const k2s2 = (k.value * sizeMm2 * runs) ** 2;
        const ik = d.faultAtBreaker.ikMaxKa * 1000;
        const withstandS = k2s2 / (ik * ik);
        const mv = from?.kind === 'transformer' ? ' MV protection time (OI-31) and' : '';
        result.c4 = {
          state: 'device-data-required',
          detail: `Phase k ${k.value}: k²S² ${k2s2.toExponential(3)} A²s, withstands ${d.faultAtBreaker.ikMaxKa.toFixed(2)} kA for ${withstandS.toFixed(3)} s; ECC k ${kE.value}. Needs the${mv} breaker let-through I²t (OI-03).`,
        };
        if (!result.errors.includes('E2402')) result.errors.push('E2402');
      }
    }

    // C5 (10.10): not required behind an ELCB; else Zs(hot) <= 0.95 x 230 / Ia.
    if (ticked.earthFaultLoopImpedance) {
      const elcb = 'earthLeakage' in to && to.earthLeakage?.startsWith('ELCB');
      const perM = loopPerMetre(d, c, ecc.value);
      const upstream = from && byTo.get(from.id);
      const zUp =
        from && sources.has(from.id)
          ? sources.get(from.id)!
          : upstream
            ? check(upstream).zsHotMohm
            : null;
      if (typeof perM === 'number' && zUp !== null) {
        result.zsHotMohm = zUp + (perM * d.lengthM) / runs;
      }
      if (elcb) {
        result.c5 = {
          state: 'not-required',
          detail: `Not required - ${to.tag} has ${String(to.earthLeakage)} upstream protection.`,
        };
      } else if (result.zsHotMohm !== null) {
        const iaMax = (0.95 * U0 * 1000) / result.zsHotMohm;
        result.c5 = {
          state: 'device-data-required',
          detail: `Zs (hot) ${result.zsHotMohm.toFixed(3)} mOhm: passes if the breaker disconnects within ${DISCONNECT_S} s at Ia <= ${iaMax.toFixed(0)} A; Ia = 1.2 x Im needs the catalogue (OI-03).`,
        };
        if (!result.errors.includes('E2402')) result.errors.push('E2402');
      } else {
        result.c5 = {
          state: 'not-calculated',
          detail:
            typeof perM === 'string'
              ? perM
              : 'Upstream loop unknown (riser busbar, OI-13, or no source).',
        };
      }
    }
    return result;
  };
  return duties.map(check);
}
