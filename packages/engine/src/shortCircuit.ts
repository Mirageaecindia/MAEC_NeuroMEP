import type { Cable, Element, Project } from '@neuromep/shared';
import { getRulePack } from '@neuromep/rulepacks';
import type { Sizes } from './checks.js';
import { tableValue } from './tables.js';

/**
 * Three-phase short-circuit currents (10.8, #TASK-23) by the CableSizer v1.1 method (decision
 * 3 Nov 2026): Isc = c x Vn / (sqrt3 x Zkt) with c = 1 for 230/400 V; upstream network
 * Zup = Vn² / Sup, Xup = 0.995 Zup, Rup = 0.1 Xup; transformer Zk = uk Vn² / S, Rk = ur Vn² / S,
 * Xk = sqrt(Zk² - Rk²) (no KT); generator Xkt = X"d Vn² / S, Rkt = 0.1 Xkt (no KG); cables
 * Rk = rho L / (A N) (rho 18.32 Cu / 30.34 Al), Xk = 0.1 L / N below 120 mm², 0.09 L / N from
 * 120 mm²; motors in parallel at the main LV panel (IL/IF from the rule pack). The minimum uses
 * conductor resistance at fault temperature (x 1.6 XLPE / 1.38 PVC) and the highest generator
 * X"d. Peak ip = kappa x sqrt2 x Ik" (10.8, V-10).
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
/** Conductor resistivity at 20 deg C, mOhm mm²/m (CableSizer). */
const RHO = { Cu: 18.32, Al: 30.34 } as const;
/** Resistance at fault temperature, for minimum currents (CableSizer FactorR). */
const HOT = { PVC: 1.38, XLPE: 1.6, FR: 1.6 } as const;

const add = (a: Z, b: Z): Z => ({ r: a.r + b.r, x: a.x + b.x });
/** Ik" in kA: V / mOhm = kA. */
const ik = (c: number, z: Z) => (c * VN) / (SQRT3 * Math.hypot(z.r, z.x));
const kappa = (z: Z) => 1.02 + 0.98 * Math.exp((-3 * z.r) / z.x);

/** Cable impedance (mOhm), cold for maximum or at fault temperature for minimum currents. */
function cableZ(cable: Cable, s: Sizes, lengthM: number, hot: boolean): Z {
  const c = cable.construction;
  const r = (RHO[c.conductor] * lengthM) / (s.sizeMm2 * s.runs);
  const x = ((s.sizeMm2 < 120 ? 0.1 : 0.09) * lengthM) / s.runs;
  return { r: hot ? r * HOT[c.insulation] : r, x };
}

/** Parallel combination a b / (a + b) of two complex impedances (motor group with the network). */
export function parallel(a: Z, b: Z): Z {
  const nr = a.r * b.r - a.x * b.x;
  const ni = a.r * b.x + a.x * b.r;
  const dr = a.r + b.r;
  const di = a.x + b.x;
  const den = dr * dr + di * di;
  return { r: (nr * dr + ni * di) / den, x: (ni * dr - nr * di) / den };
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

  const num = (key: string) => {
    const o = project.calculation.defaultOverrides[key];
    if (typeof o === 'number') return o;
    const v = pack.calculationDefaults.find((d) => d.key === key)?.value;
    return typeof v === 'number' ? v : null;
  };
  const vn2 = VN * VN;

  // Impedances of the source in this scenario, at the LV terminals (max, min).
  const sourceZ = (e: Element): { max: Z; min: Z; notes: string[] } | FaultResult => {
    const notes: string[] = [];
    if (e.kind === 'transformer') {
      const sq = project.calculation.upstreamFaultMva;
      if (!sq) {
        return {
          ok: false,
          code: 'E2301',
          detail: 'Enter the upstream fault level (MVA) on Page 1.',
        };
      }
      if (!e.kva)
        return { ok: false, code: 'E2301', detail: `Enter the rating (kVA) of ${e.tag}.` };
      // Upstream network (CableSizer): Zup = Vn² / Sup, Xup = 0.995 Zup, Rup = 0.1 Xup.
      const zq = vn2 / (sq * 1000);
      const q: Z = { r: 0.1 * 0.995 * zq, x: 0.995 * zq };
      // Transformer: uk from the manufacturer catalogue by rating and primary voltage if not entered.
      let uk = e.ukPct;
      if (uk === null) {
        const kv = e.primaryV ? e.primaryV / 1000 : 11;
        const set = pack.sourceData.transformerUkPct.find((t) => kv <= t.maxPrimaryKv);
        const row = set?.rows.find((r) => e.kva! <= r.maxKva);
        if (!row) return { ok: false, code: 'E2301', detail: `Enter uk (%) of ${e.tag}.` };
        uk = row.ukPct;
        const at = e.primaryV ? `${kv} kV` : '11 kV assumed - primary voltage not entered';
        notes.push(`${e.tag}: uk ${uk} % (manufacturer catalogue, ${e.kva} kVA, ${at}).`);
      }
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
      const t: Z = { r: rt, x: Math.sqrt(Math.max(0, zt * zt - rt * rt)) };
      return { max: add(q, t), min: add(q, t), notes };
    }
    // Generator: X"d entered, else the typical range by rating - lowest for the maximum fault,
    // highest for the minimum (decision 3 Nov 2026); Rkt = 0.1 Xkt.
    if (e.kind !== 'generator' || !e.kvaOverride) {
      return { ok: false, code: 'E2301', detail: `Enter the rating (kVA) of ${e.tag}.` };
    }
    const kva = e.kvaOverride;
    const range = pack.sourceData.generatorXdPct.find((g) => kva <= g.maxKva)!;
    const xdMax = e.xdSubtransientPct ?? range.low;
    const xdMin = e.xdSubtransientPct ?? range.high;
    if (e.xdSubtransientPct === null) {
      notes.push(
        `${e.tag}: X"d ${range.low} - ${range.high} % typical for ${kva} kVA: ${range.low} % for the maximum, ${range.high} % for the minimum fault.`,
      );
    }
    const base = (vn2 / (kva * 1000)) * 1000;
    const gen = (xd: number): Z => ({ r: 0.1 * (xd / 100) * base, x: (xd / 100) * base });
    let min = gen(xdMin);
    if (e.sustainedScKa) {
      const zs = (cmin * VN) / (SQRT3 * e.sustainedScKa); // mOhm
      min = { r: 0.1 * zs, x: zs };
    }
    return { max: gen(xdMax), min, notes };
  };

  // Motor group of a main LV panel (CableSizer "MDB including motor"): the motors fed from it,
  // ZM = Vn² / (IL/IF x SrM), XM = 0.922 ZM, RM = 0.42 XM (V-21), SrM = P / (efficiency x pf).
  const ilIf = num('motorLockedRotorRatio');
  const pf = num('defaultLoadPowerFactor');
  const motorGroup = (boardId: string): { z: Z | null; notes: string[] } => {
    const below = new Set<string>();
    const stack = [boardId];
    while (stack.length) {
      const cur = stack.pop()!;
      const next = [
        ...cables.filter((c) => c.from.elementId === cur).map((c) => c.to.elementId),
        ...risers.filter((r) => r.fedFromId === cur).flatMap((r) => r.feeds),
      ];
      for (const id of next) {
        if (!below.has(id)) {
          below.add(id);
          stack.push(id);
        }
      }
    }
    const motors = elements.filter((m) => m.kind === 'motor' && below.has(m.id));
    if (!motors.length) return { z: null, notes: [] };
    if (!ilIf || !pf) {
      return {
        z: null,
        notes: ['Motor contribution not included: IL/IF or power factor missing.'],
      };
    }
    let srm = 0;
    const skipped: string[] = [];
    for (const m of motors) {
      if (m.kind !== 'motor') continue;
      const kw = m.manualLoads.reduce(
        (t, l) => t + (l.method === 'kw' ? l.kwL1 + l.kwL2 + l.kwL3 : 0),
        0,
      );
      if (!m.efficiency) skipped.push(m.tag);
      else srm += kw / (m.efficiency * pf);
    }
    const notes = skipped.length
      ? [`Motor contribution without ${skipped.join(', ')} (efficiency missing).`]
      : [];
    if (srm <= 0) return { z: null, notes };
    const zm = vn2 / (ilIf * srm); // mOhm, SrM in kVA
    const xm = 0.922 * zm;
    notes.push(`Motor contribution included: ${srm.toFixed(1)} kVA of motors, IL/IF ${ilIf}.`);
    return { z: { r: 0.42 * xm, x: xm }, notes };
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
      let toMax = add(max, cableZ(cable, s, len, false));
      let toNotes = notes;
      // Motors feed a fault from the main LV panel downwards (maximum only).
      if (scenario === 'normal' && e.kind === 'transformer') {
        const m = motorGroup(to.id);
        if (m.z) toMax = parallel(toMax, m.z);
        toNotes = [...notes, ...m.notes];
      }
      visit(to, toMax, min ? add(min, cableZ(cable, s, len, true)) : null, toNotes, next);
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
    visit(src, z.max, z.min, [...z.notes], new Set([src.id]));
  }
  return out;
}
