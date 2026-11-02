import type { Cable } from '@neuromep/shared';
import { interpolated, tableValue, type TableValue } from './tables.js';

/**
 * Current-carrying capacity (C1, 10.6) and voltage drop (C2, 10.7) of one cable at a given size,
 * from the CableSizer v1.1 tables. Each result is either a value with notes, or blocked with the
 * error code and what is missing (V-14: nothing is assumed).
 */

export type Blocked = { ok: false; code: 'E2101' | 'E2102'; detail: string };
type Ok<T> = { ok: true; notes: string[]; warnings: string[] } & T;
export type Outcome<T> = Ok<T> | Blocked;

export interface Site {
  airC: number | null;
  groundC: number | null;
  soilResistivity: number | null;
}

export interface Rating {
  itA: number;
  k1: number;
  k2: number;
  kr: number;
  k3: number;
  /** Iz = It x K1 x K2 x Kr x K3 x runs. */
  izA: number;
}

type Construction = Cable['construction'];
const SQRT3 = Math.sqrt(3);

/** CableSizer insulation key; fire-rated cable has no mapped table yet (OI-18). */
function insulationKey(c: Construction): string | Blocked {
  if (c.insulation === 'FR') {
    return {
      ok: false,
      code: 'E2102',
      detail: 'Fire-rated cable is not mapped to a CableSizer table yet (OI-18).',
    };
  }
  return c.insulation;
}
const methodKey = (c: Construction) => (c.method === 'B' ? 'B' : c.method === 'J' ? 'J' : 'D');
const buryKey = (c: Construction) => (c.method === 'D-duct' ? 'DUCT' : 'DIRECT BURIED');
const blocked = (detail: string, code: Blocked['code'] = 'E2102'): Blocked => ({
  ok: false,
  code,
  detail,
});
const isBlocked = (x: unknown): x is Blocked =>
  typeof x === 'object' && x !== null && (x as Blocked).ok === false;

/** Grouping factor K2 by installation method (CableSizer GROUPB / GROUPJ / GROUPD). */
function groupingFactor(c: Construction): TableValue {
  const cir = c.groupedCircuits;
  if (cir === null) return { found: false, detail: 'Enter the number of grouped circuits.' };
  if (c.method === 'B') return tableValue('GROUPB', { CIR: cir });
  if (c.separation === null) return { found: false, detail: 'Enter the separation of the cables.' };
  const sep = c.separation === 'touching' ? 'TOUCHING' : c.separation;
  if (c.method === 'J') {
    if (c.trays === null) return { found: false, detail: 'Enter the number of trays.' };
    return tableValue('GROUPJ', { CORE: c.cores, CIR: cir, SEP: sep, no: c.trays });
  }
  return tableValue('GROUPD', {
    CORE: c.cores,
    BURY: buryKey(c),
    CIR: cir,
    SEP: sep === 'TOUCHING' ? sep : Number(sep),
  });
}

/** Base rating It and the derating factors of a cable at one size (C1). */
export function cableRating(
  c: Construction,
  phases: 1 | 3,
  sizeMm2: number,
  runs: number,
  site: Site,
): Outcome<Rating> {
  const ins = insulationKey(c);
  if (isBlocked(ins)) return ins;
  const notes: string[] = [];
  const warnings: string[] = [];
  const take = (v: TableValue): number | Blocked => {
    if (!v.found) return blocked(v.detail);
    notes.push(...v.notes);
    return v.value;
  };
  const rating = c.conductor === 'Cu' ? 'NOMRATCU' : 'NOMRATAL';
  const ratingAt = (size: number) =>
    tableValue(rating, { PHASE: phases, CORE: c.cores, METHOD: methodKey(c), INS: ins, size });
  const nominal = ratingAt(sizeMm2);
  if (!nominal.found) return blocked(nominal.detail, 'E2101');
  const itA = nominal.value;
  notes.push(...nominal.notes);
  // Known CableSizer data errors (V-12): a size rated below the next smaller one is suspect.
  const sizes = [
    1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630,
  ];
  const smaller = sizes.filter((s) => s < sizeMm2).reverse()[0];
  const prev = smaller === undefined ? null : ratingAt(smaller);
  if (prev?.found && prev.value > itA) {
    warnings.push(
      `E2103: ${rating} rates ${sizeMm2} mm² at ${itA} A, below ${smaller} mm² (${prev.value} A) - suspected table error (V-12, OI-07).`,
    );
  }

  const buried = methodKey(c) === 'D';
  const temp = buried ? site.groundC : site.airC;
  if (temp === null) return blocked(`Enter the ${buried ? 'ground' : 'air'} temperature (Page 1).`);
  const k1 = take(interpolated('TEMPDE', { METHOD: methodKey(c), TYP: ins }, 'TEMP', temp));
  if (isBlocked(k1)) return k1;
  const k2 = take(groupingFactor(c));
  if (isBlocked(k2)) return k2;
  let kr = 1;
  let k3 = 1;
  if (buried) {
    if (site.soilResistivity === null) return blocked('Enter the soil resistivity (Page 1).');
    if (c.depthM === null) return blocked('Enter the depth of laying.');
    const base = { METHOD: buryKey(c), CORE: c.cores, size: sizeMm2 };
    const r = take(interpolated('STR', base, 'RESISTIVITY', site.soilResistivity));
    if (isBlocked(r)) return r;
    const d = take(interpolated('DLAY', base, 'DEPTH', c.depthM));
    if (isBlocked(d)) return d;
    kr = r;
    k3 = d;
  }
  return {
    ok: true,
    itA,
    k1,
    k2,
    kr,
    k3,
    izA: itA * k1 * k2 * kr * k3 * runs,
    notes,
    warnings,
  };
}

export interface Drop {
  /** Unit voltage drop, mV/A/m. */
  vuMvAm: number;
  /** Circuit voltage drop (V) and as % of the nominal voltage. */
  vcV: number;
  vcPct: number;
}

/**
 * Voltage drop of one circuit (C2, 10.7): sizes from 25 mm² use r and x with the load power
 * factor; smaller sizes use the tabulated mV/A/m (reactance negligible). Single-phase drops are the
 * two-conductor values, 2 / sqrt3 x the three-phase values (V-15).
 */
export function voltageDrop(
  c: Construction,
  phases: 1 | 3,
  sizeMm2: number,
  runs: number,
  ibA: number,
  pf: number,
  lengthM: number,
): Outcome<Drop> {
  const ins = insulationKey(c);
  if (isBlocked(ins)) return ins;
  const notes: string[] = [];
  let vu: number;
  if (sizeMm2 < 25) {
    const v = tableValue('VU', { CAB: sizeMm2, TYP: ins, PHASES: phases });
    if (!v.found) return blocked(v.detail);
    notes.push(...v.notes);
    vu = v.value;
  } else {
    if (c.conductor !== 'Cu') {
      return blocked('Voltage-drop r / x tables cover copper only; aluminium needs data (OI-18).');
    }
    const pvc = ins === 'PVC';
    const r = tableValue(pvc ? 'RESISPVC' : 'RESIS', { CAB: sizeMm2 });
    const x = tableValue(pvc ? 'REACTPVC' : 'REACT', { CAB: sizeMm2 });
    if (!r.found) return blocked(r.detail);
    if (!x.found) return blocked(x.detail);
    notes.push(...r.notes, ...x.notes);
    const vu3 = r.value * pf + x.value * Math.sin(Math.acos(pf));
    vu = phases === 1 ? (2 / SQRT3) * vu3 : vu3;
    if (c.cores === '1C') notes.push('Single-core r / x taken from multicore values (V-15).');
  }
  const vcV = (ibA * lengthM * vu) / (1000 * runs);
  return {
    ok: true,
    vuMvAm: vu,
    vcV,
    vcPct: (vcV / (phases === 1 ? 230 : 400)) * 100,
    notes,
    warnings: [],
  };
}
