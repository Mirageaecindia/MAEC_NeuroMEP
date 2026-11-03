import type { Element, Project } from '@neuromep/shared';
import { getRulePack, type BreakerType } from '@neuromep/rulepacks';
import { checkNetworkFeeders, type CheckState, type FeederCheck, type Sizes } from './checks.js';
import { faultLevels, type BusbarZ, type FaultResult } from './shortCircuit.js';

/**
 * Fault duty (10.8, V-10): breaker breaking / making capacity (C3) at the board where it is
 * installed, and switchboard short-time withstand (C7), against the higher of the normal and standby
 * maximum fault levels (#TASK-23).
 */

/**
 * Minimum ratio Icm / Icu of IEC 60947-2 Table 2 (until the breaker catalogue, OI-03, gives the
 * actual making capacity).
 */
export function makingFactor(icuKa: number): number {
  return icuKa <= 6 ? 1.5 : icuKa <= 10 ? 1.7 : icuKa <= 20 ? 2.0 : icuKa <= 50 ? 2.1 : 2.2;
}

export interface BreakerDuty {
  type: BreakerType;
  icuKa: number;
  icmKa: number;
}

/** The lowest fault rating of the type (or the next type) with Icu >= Ik"max and Icm >= ip. */
export function breakerDuty(
  devices: ReturnType<typeof getRulePack>['devices'],
  type: BreakerType,
  ikMaxKa: number,
  ipKa: number,
): BreakerDuty | null {
  const from = devices.breakerTypes.findIndex((t) => t.type === type);
  for (const t of devices.breakerTypes.slice(Math.max(0, from))) {
    for (const icu of [...t.faultRatingsKa].sort((a, b) => a - b)) {
      const icm = icu * makingFactor(icu);
      if (icu >= ikMaxKa && icm >= ipKa) return { type: t.type, icuKa: icu, icmKa: icm };
    }
  }
  return null;
}

/** DEWA minimum short-time withstand of a switchboard, 40 kA for 1 s (10.8). */
export const DEWA_MIN_ICW_KA = 40;

export interface Withstand {
  state: CheckState | 'not-calculated';
  detail: string;
}

/** C7 for a switchboard: Icw (1 s) >= max(Ik"max, 40 kA) and Ipk >= ip. */
export function boardWithstand(board: Element, ikMaxKa: number, ipKa: number): Withstand {
  const icw = 'icwKa' in board ? board.icwKa : null;
  const ipk = 'ipkKa' in board ? board.ipkKa : null;
  if (icw === null || ipk === null) {
    return { state: 'not-calculated', detail: `Enter Icw and Ipk of ${board.tag} to check C7.` };
  }
  const need = Math.max(ikMaxKa, DEWA_MIN_ICW_KA);
  const pass = icw >= need && ipk >= ipKa;
  return {
    state: pass ? 'pass' : 'fail',
    detail: `${board.tag}: Icw ${icw} kA vs ${need.toFixed(2)} kA, Ipk ${ipk} kA vs ip ${ipKa.toFixed(2)} kA`,
  };
}

export interface DutyCheck extends FeederCheck {
  /** Highest maximum fault at the breaker (its source board) over both scenarios. */
  faultAtBreaker: { ikMaxKa: number; ipKa: number } | null;
  /** Minimum fault at the far end (protection checks C4 / C5), lowest over both scenarios. */
  ikMinFarKa: number | null;
  duty: BreakerDuty | null;
  c3: CheckState | 'not-calculated';
  c7: Withstand | null;
  /** A busbar feeder's own short-time withstand (C7) at the fault level where it starts. */
  busbarWithstand: Withstand | null;
}

/** C1 / C2 (checks.ts), then the fault levels at the sizes found and C3 / C7 on every feeder. */
export function checkNetwork(project: Project, sized?: ReadonlyMap<string, Sizes>): DutyCheck[] {
  const pack = getRulePack(project.rulePackId!, project.rulePackVersion!);
  const { feeders, risers } = checkNetworkFeeders(project, sized);
  const busbars = new Map<string, BusbarZ>();
  for (const f of feeders) {
    if (f.busbar)
      busbars.set(f.cableId, {
        r20: f.busbar.r20MohmM,
        rHot: f.busbar.rHotMohmM,
        x: f.busbar.xMohmM,
      });
  }
  for (const r of risers) {
    if (r.busbar)
      busbars.set(r.riserId, {
        r20: r.busbar.r20MohmM,
        rHot: r.busbar.rHotMohmM,
        x: r.busbar.xMohmM,
      });
  }
  const sizes = new Map<string, Sizes>();
  const lengths = new Map<string, number>();
  for (const f of feeders) {
    if (f.size) sizes.set(f.cableId, f.size);
    lengths.set(f.cableId, f.lengthM);
  }
  const levels = (['normal', 'standby'] as const).map((s) =>
    faultLevels(project, s, sizes, lengths, busbars),
  );
  const ok = (r: FaultResult | undefined) => (r?.ok ? r : null);
  const elements = new Map(project.model.elements.map((e) => [e.id, e]));
  const cables = new Map(project.model.cables.map((c) => [c.id, c]));

  return feeders.map((f): DutyCheck => {
    const fromId = cables.get(f.cableId)!.from.elementId;
    const at = levels.map((l) => ok(l.get(fromId))).filter((x) => x !== null);
    const far = levels.map((l) => ok(l.get(f.toId))).filter((x) => x !== null);
    const blockedAt = levels.map((l) => l.get(fromId)).find((r) => r && !r.ok);
    const result: DutyCheck = {
      ...f,
      errors: [...f.errors],
      trace: [...f.trace],
      faultAtBreaker: at.length
        ? {
            ikMaxKa: Math.max(...at.map((x) => x.ikMaxKa)),
            ipKa: Math.max(...at.map((x) => x.ipKa)),
          }
        : null,
      ikMinFarKa: far.some((x) => x.ikMinKa === null)
        ? null
        : far.length
          ? Math.min(...far.map((x) => x.ikMinKa!))
          : null,
      duty: null,
      c3: 'not-calculated',
      c7: null,
      busbarWithstand: null,
    };
    for (const n of new Set(at.flatMap((x) => x.notes)))
      result.trace.push({ step: 'C3', detail: n });
    if (blockedAt && !blockedAt.ok) {
      result.trace.push({ step: 'C3', detail: blockedAt.detail });
      if (!result.errors.includes(blockedAt.code)) result.errors.push(blockedAt.code);
    }
    const fault = result.faultAtBreaker;
    if (fault && f.device) {
      result.duty = breakerDuty(pack.devices, f.device.type, fault.ikMaxKa, fault.ipKa);
      result.c3 = result.duty ? 'pass' : 'fail';
      if (!result.duty) {
        result.errors.push('E2002');
        result.status = 'blocked';
      }
      result.trace.push({
        step: 'C3',
        detail: `Ik"max ${fault.ikMaxKa.toFixed(2)} kA, ip ${fault.ipKa.toFixed(2)} kA at the breaker: ${
          result.duty
            ? `${result.duty.type} Icu ${result.duty.icuKa} kA, Icm >= ${result.duty.icmKa.toFixed(1)} kA (IEC 60947-2 minimum until OI-03)`
            : 'above the highest rating (85 kA)'
        }`,
      });
    }
    // C7 of a busbar feeder itself: its Icw / Ipk against the fault where it starts.
    if (f.busbar && fault) {
      const { icwKa, ipkKa, ratingA } = f.busbar;
      if (icwKa === null || ipkKa === null) {
        result.busbarWithstand = {
          state: 'not-calculated',
          detail: `Icw / Ipk of the ${ratingA} A ${f.busbar.maker} busbar are not in the data.`,
        };
      } else {
        const ok = icwKa >= fault.ikMaxKa && ipkKa >= fault.ipKa;
        result.busbarWithstand = {
          state: ok ? 'pass' : 'fail',
          detail: `${ratingA} A busbar: Icw ${icwKa} kA vs ${fault.ikMaxKa.toFixed(2)} kA, Ipk ${ipkKa} kA vs ip ${fault.ipKa.toFixed(2)} kA`,
        };
      }
      result.trace.push({ step: 'C7', detail: result.busbarWithstand.detail });
    }
    // C7 on the board this feeder supplies.
    const to = elements.get(f.toId)!;
    const farMax = far.length ? Math.max(...far.map((x) => x.ikMaxKa)) : null;
    if (farMax !== null && 'icwKa' in to) {
      result.c7 = boardWithstand(to, farMax, Math.max(...far.map((x) => x.ipKa)));
      result.trace.push({ step: 'C7', detail: result.c7.detail });
    }
    return result;
  });
}
