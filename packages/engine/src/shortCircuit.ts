import type { Cable, Element, Project } from '@neuromep/shared';
import { getRulePack } from '@neuromep/rulepacks';
import type { Sizes } from './checks.js';
import { tableValue } from './tables.js';

/**
 * Three-phase short-circuit currents to IEC 60909 (10.8, #TASK-23): maximum Ik" (cmax, cold
 * conductors, trefoil reactance for single-core) and minimum Ik" (cmin, conductors at end-of-fault
 * temperature, flat reactance), peak current ip, at every component, for the normal (transformer)
 * and standby (generator through the ATS) supply.
 */

export type Scenario = 'normal' | 'standby';
export type { Sizes } from './checks.js';

/** R and X in mOhm. */
interface Z {
  r: number;
  x: number;
}

export interface FaultLevel {
  ikMaxKa: number;
  ipKa: number;
  /** R / X of the maximum-fault impedance at this point (mOhm). */
  rMax: number;
  xMax: number;
  /** Null when an impedance on the path is unknown (riser or busbar datasheet, OI-13). */
  ikMinKa: number | null;
  notes: string[];
}

export type FaultResult =
  ({ ok: true } & FaultLevel) | { ok: false; code: 'E2301' | 'E2102'; detail: string };

const VN = 400;
const SQRT3 = Math.sqrt(3);
/** Typical cable reactance per arrangement (10.8, V-20), mOhm/m. */
const X_MULTICORE = 0.08;
const X_TREFOIL = 0.085;
const X_FLAT = 0.095;
/** Conductor temperature at the end of a fault (IEC 60949): PVC 160 deg C, XLPE / FR 250 deg C. */
const END_OF_FAULT_C = { PVC: 160, XLPE: 250, FR: 250 } as const;
/** IEC 60076-5 minimum uk by rating (10.8). */
function defaultUk(kva: number): number {
  return kva <= 630 ? 4 : kva <= 1250 ? 5 : kva <= 2500 ? 6 : 7;
}

const add = (a: Z, b: Z): Z => ({ r: a.r + b.r, x: a.x + b.x });
/** Ik" in kA: V / mOhm = kA. */
const ik = (c: number, z: Z) => (c * VN) / (SQRT3 * Math.hypot(z.r, z.x));
const kappa = (z: Z) => 1.02 + 0.98 * Math.exp((-3 * z.r) / z.x);

/** Cable impedance (mOhm) at maximum (cold) or minimum (hot) fault conditions (V-20). */
function cableZ(cable: Cable, s: Sizes, lengthM: number, hot: boolean): Z | string {
  const c = cable.construction;
  if (c.conductor !== 'Cu') return 'Aluminium conductor resistance is not in the tables (OI-18).';
  const r20 = tableValue('Rs', { size: s.sizeMm2 });
  if (!r20.found) return r20.detail;
  const theta = END_OF_FAULT_C[c.insulation];
  const r = r20.value * (hot ? 1 + 0.004 * (theta - 20) : 1);
  const x = c.cores === '1C' ? (hot ? X_FLAT : X_TREFOIL) : X_MULTICORE;
  return { r: (r * lengthM) / s.runs, x: (x * lengthM) / s.runs };
}

/**
 * Fault levels at every component reached from a source in one scenario. `sizes` and `lengths`
 * give each feeder's size and length (from the C1 / C2 step).
 */
export function faultLevels(
  project: Project,
  scenario: Scenario,
  sizes: ReadonlyMap<string, Sizes>,
  lengths: ReadonlyMap<string, number>,
): Map<string, FaultResult> {
  const pack = getRulePack(project.rulePackId!, project.rulePackVersion!);
  const factor = (key: string) =>
    pack.calculationDefaults.find((d) => d.key === key)?.value as number;
  const cmax = factor('voltageFactorCmax');
  const cmin = factor('voltageFactorCmin');
  const { elements, cables, risers } = project.model;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out = new Map<string, FaultResult>();
  const hasMotors = elements.some((e) => e.kind === 'motor');

  // Impedances of the source in this scenario, at the LV terminals (max, min).
  const sourceZ = (e: Element): { max: Z; min: Z; notes: string[] } | FaultResult => {
    const notes: string[] = [];
    const vn2 = VN * VN;
    if (e.kind === 'transformer') {
      const sq = project.calculation.upstreamFaultMva;
      if (!sq)
        return {
          ok: false,
          code: 'E2301',
          detail: 'Enter the upstream fault level (MVA) on Page 1.',
        };
      if (!e.kva)
        return { ok: false, code: 'E2301', detail: `Enter the rating (kVA) of ${e.tag}.` };
      // Upstream network (V-17): ZQ = cQ Vn² / S"kQ, XQ = 0.995 ZQ, RQ = 0.1 XQ.
      const zq = (cmax * vn2) / (sq * 1000);
      const q: Z = { r: 0.1 * 0.995 * zq, x: 0.995 * zq };
      notes.push('Minimum fault uses the Page 1 upstream level: DEWA minimum not given (OI-33).');
      // Transformer (V-18) with the correction factor KT.
      const uk = e.ukPct ?? defaultUk(e.kva);
      if (e.ukPct === null)
        notes.push(`${e.tag}: uk ${uk} % (IEC 60076-5 minimum for ${e.kva} kVA).`);
      let ur = e.urPct;
      if (ur === null) {
        const t = tableValue('Ur', { kVA: e.kva });
        if (!t.found) return { ok: false, code: 'E2301', detail: `Enter ur (%) of ${e.tag}.` };
        ur = t.value;
        notes.push(`${e.tag}: ur ${ur} % (CableSizer table).`);
      }
      const base = (vn2 / (e.kva * 1000)) * 1000; // Vn² / S in mOhm
      const zt = (uk / 100) * base;
      const rt = (ur / 100) * base;
      const xt = Math.sqrt(Math.max(0, zt * zt - rt * rt));
      const kt = (0.95 * cmax) / (1 + 0.6 * (xt / base));
      const t: Z = { r: rt * kt, x: xt * kt };
      return { max: add(q, t), min: add(q, t), notes };
    }
    // Generator (V-19): X"d with RG = 0.15 X"d and KG; the minimum comes from the sustained current.
    if (e.kind !== 'generator' || !e.kvaOverride || !e.xdSubtransientPct) {
      return { ok: false, code: 'E2301', detail: `Enter the rating (kVA) and X"d of ${e.tag}.` };
    }
    const base = (vn2 / (e.kvaOverride * 1000)) * 1000;
    const xd = (e.xdSubtransientPct / 100) * base;
    const kg = cmax / (1 + (e.xdSubtransientPct / 100) * 0.6); // sin phi rG = 0.6 at pf 0.8
    const g: Z = { r: 0.15 * xd * kg, x: xd * kg };
    let min = g;
    if (e.sustainedScKa) {
      const zs = (cmin * VN) / (SQRT3 * e.sustainedScKa); // mOhm
      min = { r: 0.15 * zs, x: zs };
    } else notes.push(`${e.tag}: sustained short-circuit current not entered; minimum uses X"d.`);
    return { max: g, min, notes };
  };

  const visit = (e: Element, max: Z, min: Z | null, notes: string[], seen: Set<string>) => {
    out.set(e.id, {
      ok: true,
      ikMaxKa: ik(cmax, max),
      ipKa: kappa(max) * Math.SQRT2 * ik(cmax, max),
      rMax: max.r,
      xMax: max.x,
      ikMinKa: min ? ik(cmin, min) : null,
      notes,
    });
    for (const cable of cables) {
      if (cable.from.elementId !== e.id || seen.has(cable.to.elementId)) continue;
      const to = byId.get(cable.to.elementId);
      if (!to) continue;
      // An ATS takes the input of the scenario only (normal: transformer side, standby: generator).
      if (to.kind === 'ats' && cable.to.port !== scenario) continue;
      const next = new Set([...seen, to.id]);
      if (cable.feederType === 'busbar') {
        visit(to, max, null, [...notes, 'Busbar impedance not included (datasheet, OI-13).'], next);
        continue;
      }
      const s = sizes.get(cable.id);
      const len = lengths.get(cable.id);
      if (!s || len === undefined) {
        out.set(to.id, { ok: false, code: 'E2102', detail: `${cable.tag} has no size yet.` });
        continue;
      }
      const zMax = cableZ(cable, s, len, false);
      const zMin = cableZ(cable, s, len, true);
      if (typeof zMax === 'string' || typeof zMin === 'string') {
        out.set(to.id, {
          ok: false,
          code: 'E2102',
          detail: String(typeof zMax === 'string' ? zMax : zMin),
        });
        continue;
      }
      visit(to, add(max, zMax), min ? add(min, zMin) : null, notes, next);
    }
    for (const r of risers) {
      if (r.fedFromId !== e.id) continue;
      for (const id of r.feeds) {
        const to = byId.get(id);
        if (!to || seen.has(id)) continue;
        // Riser busbar R / X unknown: the maximum ignores it (higher, safe side), no minimum.
        visit(
          to,
          max,
          null,
          [...notes, 'Riser impedance not included (busbar datasheet, OI-13).'],
          new Set([...seen, id]),
        );
      }
    }
  };

  const sources = elements.filter((e) =>
    scenario === 'normal' ? e.kind === 'transformer' : e.kind === 'generator',
  );
  for (const src of sources) {
    const z = sourceZ(src);
    if ('ok' in z) {
      out.set(src.id, z);
      continue;
    }
    const notes = [...z.notes];
    if (hasMotors)
      notes.push(
        'Motor contribution not included: locked-rotor ratio IL/IF not confirmed (OI-30).',
      );
    visit(src, z.max, z.min, notes, new Set([src.id]));
  }
  return out;
}
