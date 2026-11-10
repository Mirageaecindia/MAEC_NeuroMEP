import { checkNetworkFeeders, designFeeders, riserCosts } from '@neuromep/engine';
import { busbarChoices } from '@neuromep/engine';
import { getRulePack } from '@neuromep/rulepacks';
import {
  cableLength,
  capacitySummary,
  generatorAnalyses,
  inputsKey,
  isPlaceable,
  libraryItem,
  loadSummaries,
  pfcRating,
  placeElement,
  resultOf,
  type Cable,
  type ElementResult,
  type Project,
} from '@neuromep/shared';
import { crossCheckCases } from '../crosscheck/cases';
import { packProject } from '../crosscheck/pack';
import {
  calcDefault,
  lengthRule,
  loadingLimitPct,
  powerFactors,
} from '../workspace/projectDefaults';

/**
 * User guide worked examples (user request 7 Nov 2026): each calculation of the guide's
 * "Calculation" buttons worked through on one of the cross-check buildings (WBS 1.7.5). The guide
 * recomputes the figure from the formula it shows and puts it beside the figure NeuroMEP's engine
 * produced in a real Cable Size run - the same code as the app - so a reader can verify both.
 */

export interface Line {
  label: string;
  /** How the value is obtained: a formula with the numbers, or where it comes from. */
  how: string;
  value: number | string;
  unit?: string;
  digits?: number;
}

export interface Comparison {
  label: string;
  guide: number | string;
  engine: number | string | null;
  unit?: string;
  digits?: number;
  /** Numbers within 0.1 %, text identical. */
  ok: boolean;
}

export interface WorkedExample {
  id: string;
  title: string;
  /** Which building and item the numbers come from. */
  source: string;
  /** The method, a line per step, in plain words. */
  method: string[];
  inputs: Line[];
  steps: Line[];
  compare: Comparison[];
}

const SQRT3 = Math.sqrt(3);

const agree = (a: number | string, b: number | string | null) =>
  typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 0.001)
    : a === b;
const cmp = (
  label: string,
  guide: number | string,
  engine: number | string | null | undefined,
  unit?: string,
  digits?: number,
): Comparison => ({
  label,
  guide,
  engine: engine ?? null,
  ok: agree(guide, engine ?? null),
  ...(unit ? { unit } : {}),
  ...(digits === undefined ? {} : { digits }),
});
const f = (v: number, d = 2) => v.toFixed(d);

// ----- the buildings, sized once ------------------------------------------------------------

let built: Map<string, Project> | null = null;
function building(id: string): Project {
  built ??= new Map(crossCheckCases().map((c) => [c.id, packProject(c)]));
  const p = built.get(id);
  if (!p) throw new Error(`No cross-check case ${id}`);
  return p;
}

function feeder(p: Project, name: string): { cable: Cable; r: ElementResult } {
  const [from, to] = name.split(' > ');
  const tag = (id: string) => p.model.elements.find((e) => e.id === id)?.tag;
  const cable = p.model.cables.find(
    (c) => tag(c.from.elementId) === from && tag(c.to.elementId) === to,
  );
  if (!cable) throw new Error(`No feeder ${name}`);
  const r = resultOf(p, cable.id, inputsKey(p))?.result;
  if (!r) throw new Error(`No result for ${name}`);
  return { cable, r };
}

const packOf = (p: Project) => getRulePack(p.rulePackId!, p.rulePackVersion!);
const summariesOf = (p: Project) => loadSummaries(p, powerFactors(p));
const nextRating = (p: Project, a: number) =>
  packOf(p).devices.breakerRatingsA.find((r) => r >= a) ?? null;
const source = (caseId: string, what: string) =>
  `Cross-check building ${caseId} (docs/crosscheck), ${what}`;

// ----- the examples ---------------------------------------------------------------------------

function length(): WorkedExample {
  const p = building('CC-01');
  const { cable, r } = feeder(p, 'TX-1 > LV-1');
  const rule = lengthRule(p)!;
  const routed = cableLength(cable, rule).routedM;
  const add = rule.additionM ?? 0;
  return {
    id: 'length',
    title: 'Cable length',
    source: source('CC-01', `feeder ${cable.tag} TX-1 > LV-1`),
    method: [
      'Routed length = the drawn route on the plan, in metres (the plan scale comes from calibration).',
      `Cable length = routed length + ${add} m added to every cable (rule pack, A-05).`,
    ],
    inputs: [{ label: 'Routed length', how: 'measured on the plan', value: routed, unit: 'm' }],
    steps: [
      {
        label: 'Cable length',
        how: `${f(routed)} + ${add}`,
        value: routed + add,
        unit: 'm',
        digits: 2,
      },
    ],
    compare: [cmp('Cable length', routed + add, r.size?.lengthM, 'm', 2)],
  };
}

function demand(): WorkedExample {
  const p = building('CC-01');
  const { r } = feeder(p, 'TX-1 > LV-1');
  const lv = p.model.elements.find((e) => e.tag === 'LV-1')!;
  const connected = summariesOf(p).get(lv.id)!.connectedKw;
  const factor = packOf(p).demandMethods['dubai-non-emaar'].byCategory.office;
  return {
    id: 'demand',
    title: 'Maximum demand at the LV panel',
    source: source('CC-01', 'LV-1 (all loads are office DBs)'),
    method: [
      'Connected load = the sum of the kW entered on every DB below the panel.',
      'Dubai methods: the category factor is applied once, at the LV panel / MDB, to the connected load of each category.',
      'Maximum demand (MD) = connected load x category factor.',
    ],
    inputs: [
      {
        label: 'Connected load below LV-1',
        how: '3 floors x (24 + 6) kW',
        value: connected,
        unit: 'kW',
      },
      { label: 'Office factor', how: 'Dubai - Non-Emaar (rule pack)', value: factor },
    ],
    steps: [
      {
        label: 'Maximum demand',
        how: `${f(connected, 1)} x ${factor}`,
        value: connected * factor,
        unit: 'kW',
        digits: 2,
      },
    ],
    compare: [cmp('Maximum demand', connected * factor, r.load?.maxDemandKw, 'kW', 2)],
  };
}

function ibThreePhase(): WorkedExample {
  const p = building('CC-01');
  const { cable, r } = feeder(p, 'SMDB-1F > DB-1F-P');
  const P = r.load!.maxDemandKw;
  const pf = r.calc!.pf!;
  const ib = (P * 1000) / (SQRT3 * 400 * pf);
  return {
    id: 'ib-three',
    title: 'Design current Ib - balanced three-phase load',
    source: source('CC-01', `feeder ${cable.tag} SMDB-1F > DB-1F-P (8 + 8 + 8 kW)`),
    method: [
      'The same kW on L1, L2 and L3: Ib = P x 1000 / (sqrt3 x 400 V x pf).',
      'P is the demand the cable carries (after demand factors); pf is the power factor of that load.',
    ],
    inputs: [
      { label: 'Demand P', how: 'DB-1F-P loads', value: P, unit: 'kW' },
      { label: 'Power factor', how: 'entered on DB-1F-P', value: pf },
    ],
    steps: [
      {
        label: 'Ib',
        how: `${P} x 1000 / (1.732 x 400 x ${pf})`,
        value: ib,
        unit: 'A',
        digits: 2,
      },
    ],
    compare: [cmp('Ib', ib, r.values.ibA, 'A', 2)],
  };
}

function ibSinglePhase(): WorkedExample {
  const p = building('CC-04');
  const { cable, r } = feeder(p, 'SMDB-CP > DB-CP2');
  const P = r.load!.maxDemandKw;
  const pf = r.calc!.pf!;
  const ib = (P * 1000) / (230 * pf);
  const factor = p.calculation.demandFactors.byLoadType['2'].value!;
  return {
    id: 'ib-single',
    title: 'Design current Ib - single-phase load (and unbalanced boards)',
    source: source('CC-04', `feeder ${cable.tag} SMDB-CP > DB-CP2 (6 kW Power on L1)`),
    method: [
      'Single-phase, or unequal kW on the three phases: Ib = largest phase kW x 1000 / (230 V x pf).',
      'Manual demand method: the Power factor typed on Import File applies to the DB load.',
    ],
    inputs: [
      { label: 'Connected load L1', how: 'entered on DB-CP2', value: 6, unit: 'kW' },
      { label: 'Power demand factor', how: 'Import File (manual method)', value: factor },
      { label: 'Power factor', how: 'entered on DB-CP2', value: pf },
    ],
    steps: [
      { label: 'Demand P', how: `6 x ${factor}`, value: 6 * factor, unit: 'kW', digits: 2 },
      { label: 'Ib', how: `${f(P)} x 1000 / (230 x ${pf})`, value: ib, unit: 'A', digits: 2 },
    ],
    compare: [cmp('Demand', 6 * factor, P, 'kW', 2), cmp('Ib', ib, r.values.ibA, 'A', 2)],
  };
}

function ibEquipment(): WorkedExample {
  const p = building('CC-02');
  const { cable, r } = feeder(p, 'ESMDB-1 > ISO-FP');
  const pump = p.model.elements.find((e) => e.tag === 'FP-1');
  if (pump?.kind !== 'equipment') throw new Error('FP-1 missing');
  const input = pump.kw! / pump.efficiency!;
  const pf = r.calc!.pf!;
  const ib = (input * 1000) / (SQRT3 * 400 * pf);
  return {
    id: 'ib-equipment',
    title: 'Design current Ib - motor-driven equipment',
    source: source(
      'CC-02',
      `fire pump FP-1 (PHE equipment) on isolator ISO-FP, feeder ${cable.tag}`,
    ),
    method: [
      'Mechanical / PHE equipment gives its rated (nameplate) output; the isolator feeding it takes the input load.',
      'Input kW = rated kW / efficiency (efficiency is required when the equipment has a starter).',
      'Then Ib as for a balanced three-phase load, at the equipment or load-type power factor.',
    ],
    inputs: [
      { label: 'Rated output', how: 'FP-1 Engineering Property', value: pump.kw!, unit: 'kW' },
      { label: 'Efficiency', how: 'FP-1 (star-delta starter)', value: pump.efficiency! },
      {
        label: 'Power factor',
        how: 'Fire Pumps type has none: default load power factor',
        value: pf,
      },
    ],
    steps: [
      {
        label: 'Input load',
        how: `${pump.kw} / ${pump.efficiency}`,
        value: input,
        unit: 'kW',
        digits: 2,
      },
      {
        label: 'Ib',
        how: `${f(input)} x 1000 / (1.732 x 400 x ${pf})`,
        value: ib,
        unit: 'A',
        digits: 2,
      },
    ],
    compare: [cmp('Ib', ib, r.values.ibA, 'A', 2)],
  };
}

function breaker(): WorkedExample {
  const p = building('CC-01');
  const { cable, r } = feeder(p, 'SMDB-1F > DB-1F-P');
  const ib = r.values.ibA!;
  const inA = nextRating(p, ib)!;
  const type = packOf(p).devices.breakerTypes.find((t) => inA <= t.maxRatingA)!.type;
  return {
    id: 'breaker',
    title: 'Breaker rating In and type',
    source: source('CC-01', `feeder ${cable.tag} SMDB-1F > DB-1F-P`),
    method: [
      'In = the lowest standard breaker rating at or above Ib (rule pack list).',
      'Type by rating: MCB up to 63 A, MCCB up to 630 A, ACB from 800 A (interim until the breaker catalogue, OI-03).',
      'Poles: 4P from sources and into main panels, else by the phases of the load.',
    ],
    inputs: [{ label: 'Ib', how: 'from the load', value: ib, unit: 'A', digits: 2 }],
    steps: [
      { label: 'In', how: `lowest standard rating >= ${f(ib)} A`, value: inA, unit: 'A' },
      { label: 'Type', how: `${inA} A`, value: type },
    ],
    compare: [cmp('In', inA, r.device?.ratingA, 'A'), cmp('Type', type, r.device?.type)],
  };
}

function capacity(): WorkedExample {
  const p = building('CC-03');
  const { cable, r } = feeder(p, 'LV-1 > MCC-1');
  const c = r.calc!;
  const runs = r.size!.runs;
  const iz = c.itA! * c.k1! * c.k2! * c.kr! * c.k3! * runs;
  return {
    id: 'c1',
    title: 'C1 Current-carrying capacity',
    source: source('CC-03', `feeder ${cable.tag} LV-1 > MCC-1, buried direct at 0.8 m`),
    method: [
      'It = tabulated rating of the cable size for its construction and installation method (CableSizer / Ducab tables).',
      'K1 temperature (air or ground), K2 grouping, Kr soil resistivity, K3 depth - between table steps the more conservative step is taken.',
      'Iz = It x K1 x K2 x Kr x K3 x runs. C1 passes when Iz >= In.',
    ],
    inputs: [
      {
        label: 'Size',
        how: 'chosen by Cable Size',
        value: `${runs} x ${r.size!.cores} ${r.size!.sizeMm2} mm²`,
      },
      { label: 'It', how: 'NOMRATCU table', value: c.itA!, unit: 'A' },
      { label: 'K1', how: 'ground 40 °C', value: c.k1! },
      { label: 'K2', how: '2 circuits touching', value: c.k2! },
      { label: 'Kr', how: 'soil 2.0 K.m/W', value: c.kr! },
      { label: 'K3', how: 'depth 0.8 m', value: c.k3! },
      { label: 'In', how: 'breaker', value: r.device!.ratingA, unit: 'A' },
    ],
    steps: [
      {
        label: 'Iz',
        how: `${c.itA} x ${c.k1} x ${c.k2} x ${c.kr} x ${c.k3} x ${runs}`,
        value: iz,
        unit: 'A',
        digits: 2,
      },
      {
        label: 'C1',
        how: `${f(iz)} >= ${r.device!.ratingA}`,
        value: iz >= r.device!.ratingA ? 'Pass' : 'Fail',
      },
    ],
    compare: [
      cmp('Iz', iz, r.values.izA, 'A', 2),
      cmp('C1', 'Pass', r.checks.C1?.state === 'pass' ? 'Pass' : 'Fail'),
    ],
  };
}

function voltageDrop(): WorkedExample {
  const p = building('CC-04');
  const { cable, r } = feeder(p, 'MDB-1 > SMDB-CH');
  const c = r.calc!;
  const runs = r.size!.runs;
  const L = r.size!.lengthM;
  const ib = r.values.ibA!;
  const volts = (c.vuMvAm! * ib * L) / (1000 * runs);
  const pct = (volts / 400) * 100;
  const total = c.vdUpstreamPct! + pct;
  return {
    id: 'c2',
    title: 'C2 Voltage drop',
    source: source('CC-04', `feeder ${cable.tag} MDB-1 > SMDB-CH, ${runs} runs, ${L} m`),
    method: [
      'Vu (mV/A/m) from the tables: below 25 mm² the tabulated value; from 25 mm² Vu = r cos(phi) + x sin(phi) (single-phase x 2 / sqrt3).',
      'Feeder drop Vc = Vu x Ib x L / (1000 x runs) volts; % of 400 V (230 V single-phase).',
      'Total = drop up to the source board + this feeder; C2 passes when the total is within the limit of the board fed.',
    ],
    inputs: [
      { label: 'Vu', how: 'tables at pf ' + c.pf, value: c.vuMvAm!, unit: 'mV/A/m', digits: 4 },
      { label: 'Ib', how: 'from the load', value: ib, unit: 'A', digits: 2 },
      { label: 'Length', how: 'routed + 5 m', value: L, unit: 'm' },
      {
        label: 'Upstream drop',
        how: 'TX-1 > MDB-1',
        value: c.vdUpstreamPct!,
        unit: '%',
        digits: 2,
      },
      { label: 'Limit', how: 'SMDB (rule pack)', value: c.vdLimitPct!, unit: '%' },
    ],
    steps: [
      {
        label: 'Vc',
        how: `${f(c.vuMvAm!, 4)} x ${f(ib)} x ${L} / (1000 x ${runs})`,
        value: volts,
        unit: 'V',
        digits: 2,
      },
      { label: 'Vc %', how: `${f(volts)} / 400 x 100`, value: pct, unit: '%', digits: 2 },
      {
        label: 'Total',
        how: `${f(c.vdUpstreamPct!)} + ${f(pct)}`,
        value: total,
        unit: '%',
        digits: 2,
      },
    ],
    compare: [
      cmp('Feeder drop', pct, r.values.vdOwnPct, '%', 2),
      cmp('Total drop', total, r.values.vdTotalPct, '%', 2),
    ],
  };
}

function minimumSize(): WorkedExample {
  const p = building('CC-01');
  const { cable, r } = feeder(p, 'SMDB-1F > DB-1F-P');
  const inA = r.device!.ratingA;
  const rows = [...packOf(p).devices.dewaMinimumCable.rows].sort((a, b) => a.breakerA - b.breakerA);
  const row = rows.find((x) => x.breakerA >= inA)!;
  return {
    id: 'c6',
    title: 'C6 Regional minimum size and the earth conductor',
    source: source('CC-01', `feeder ${cable.tag} SMDB-1F > DB-1F-P`),
    method: [
      'DEWA minimum cable for the breaker rating (rule pack table; a rating not in the table takes the next higher row).',
      'C6 passes when size x runs >= the minimum. Cable Size always starts from this minimum.',
      'ECC: a separate Cu / PVC earth conductor per run, from the CableSizer CPC table for the phase size.',
    ],
    inputs: [{ label: 'In', how: 'breaker', value: inA, unit: 'A' }],
    steps: [
      {
        label: 'DEWA minimum',
        how: `row for ${row.breakerA} A`,
        value: `${row.runs} x ${row.sizeMm2} mm²`,
      },
      {
        label: 'Chosen size',
        how: 'Cable Size',
        value: `${r.size!.runs} x ${r.size!.sizeMm2} mm²`,
      },
      {
        label: 'ECC',
        how: `CPC table for ${r.size!.sizeMm2} mm², one per run`,
        value: `${r.size!.runs} x ${r.size!.eccMm2 ?? '-'} mm²`,
      },
    ],
    compare: [
      cmp(
        'DEWA minimum',
        `${row.runs} x ${row.sizeMm2} mm²`,
        /DEWA minimum (\d+ x [\d.]+ mm²)/.exec(r.checks.C6?.detail ?? '')?.[1],
      ),
      cmp('C6', 'Pass', r.checks.C6?.state === 'pass' ? 'Pass' : 'Fail'),
    ],
  };
}

function shortCircuit(): WorkedExample {
  const p = building('CC-04');
  const tx = p.model.elements.find((e) => e.tag === 'TX-1');
  if (tx?.kind !== 'transformer') throw new Error('TX-1 missing');
  const atTx = feeder(p, 'TX-1 > MDB-1');
  const atMdb = feeder(p, 'MDB-1 > SMDB-CP');
  const pack = packOf(p);
  const kv = (tx.primaryV ?? 11000) / 1000;
  const uk =
    tx.ukPct ??
    pack.sourceData.transformerUkPct
      .find((t) => kv <= t.maxPrimaryKv)!
      .rows.find((x) => tx.kva! <= x.maxKva)!.ukPct;
  const urText = /ur ([\d.]+) %/.exec(atTx.r.trace?.map((t) => t.detail).join(' ') ?? '')?.[1];
  const ur = tx.urPct ?? Number(urText);
  const sup = p.calculation.upstreamFaultMva!;
  // mOhm: Vn² / S with Vn = 400 V.
  const zq = (400 * 400) / sup / 1000;
  const xq = 0.995 * zq;
  const rq = 0.1 * xq;
  const zt = ((uk / 100) * (400 * 400)) / tx.kva!;
  const rt = ((ur / 100) * (400 * 400)) / tx.kva!;
  const xt = Math.sqrt(zt * zt - rt * rt);
  const R1 = rq + rt;
  const X1 = xq + xt;
  const ik1 = 400 / (SQRT3 * Math.hypot(R1, X1));
  const kappa = 1.02 + 0.98 * Math.exp((-3 * R1) / X1);
  const ip = kappa * Math.SQRT2 * ik1;
  const s = atTx.r.size!;
  const L = s.lengthM;
  const rc = (18.32 * L) / (s.sizeMm2 * s.runs);
  const xc = ((s.sizeMm2 < 120 ? 0.1 : 0.09) * L) / s.runs;
  const ik2 = 400 / (SQRT3 * Math.hypot(R1 + rc, X1 + xc));
  return {
    id: 'short-circuit',
    title: 'C3 Short circuit - Ik" max at the transformer and at the MDB',
    source: source('CC-04', 'TX-1 1000 kVA 11 kV, upstream 350 MVA, cable TX-1 > MDB-1'),
    method: [
      'CableSizer v1.1 method (manager, 3 Nov 2026): Ik" = c x 400 / (sqrt3 x |Z|) with c = 1; impedances in mOhm.',
      'Upstream network: Zq = 400² / S (MVA), Xq = 0.995 Zq, Rq = 0.1 Xq.',
      'Transformer: Zt = uk x 400² / S (kVA), Rt = ur x 400² / S, Xt = sqrt(Zt² - Rt²); uk from the manufacturer catalogue when not entered.',
      'Cable: R = 18.32 x L / (A x runs) (copper, cold for the maximum), X = 0.1 x L / runs (0.09 from 120 mm²).',
      'Peak ip = kappa x sqrt2 x Ik", kappa = 1.02 + 0.98 e^(-3R/X). C3 passes when the breaker Icu >= Ik" and Icm >= ip.',
      'Ik" min uses the conductor resistance at fault temperature (x 1.6 XLPE, x 1.38 PVC) and the highest generator X"d.',
    ],
    inputs: [
      { label: 'Upstream fault level', how: 'Import File', value: sup, unit: 'MVA' },
      { label: 'Transformer', how: 'Engineering Property', value: tx.kva!, unit: 'kVA' },
      {
        label: 'uk',
        how: tx.ukPct ? 'entered' : 'manufacturer catalogue (rule pack)',
        value: uk,
        unit: '%',
      },
      { label: 'ur', how: tx.urPct ? 'entered' : 'CableSizer Ur table', value: ur, unit: '%' },
      {
        label: 'Cable TX-1 > MDB-1',
        how: 'Cable Size',
        value: `${s.runs} x ${s.sizeMm2} mm², ${L} m`,
      },
    ],
    steps: [
      {
        label: 'Zq',
        how: `400² / (${sup} x 1000)  (V² / kVA = mOhm)`,
        value: zq,
        unit: 'mOhm',
        digits: 4,
      },
      {
        label: 'Xq / Rq',
        how: `0.995 x ${f(zq, 4)} / 0.1 x Xq`,
        value: `${f(xq, 4)} / ${f(rq, 4)}`,
        unit: 'mOhm',
      },
      {
        label: 'Rt / Xt',
        how: `Zt ${f(zt, 3)}, Rt ${f(rt, 3)}`,
        value: `${f(rt, 3)} / ${f(xt, 3)}`,
        unit: 'mOhm',
      },
      {
        label: 'Ik" at TX-1',
        how: `400 / (1.732 x |${f(R1, 3)} + j${f(X1, 3)}|)`,
        value: ik1,
        unit: 'kA',
        digits: 2,
      },
      {
        label: 'ip at TX-1',
        how: `${f(kappa, 3)} x 1.414 x ${f(ik1)}`,
        value: ip,
        unit: 'kA',
        digits: 2,
      },
      {
        label: 'Cable R / X',
        how: `18.32 x ${L} / (${s.sizeMm2} x ${s.runs}) / ${s.sizeMm2 < 120 ? 0.1 : 0.09} x ${L} / ${s.runs}`,
        value: `${f(rc, 3)} / ${f(xc, 3)}`,
        unit: 'mOhm',
      },
      {
        label: 'Ik" at MDB-1',
        how: `400 / (1.732 x |${f(R1 + rc, 3)} + j${f(X1 + xc, 3)}|)`,
        value: ik2,
        unit: 'kA',
        digits: 2,
      },
    ],
    compare: [
      cmp('Ik" at TX-1', ik1, atTx.r.values.ikMaxKa, 'kA', 2),
      cmp('ip at TX-1', ip, atTx.r.values.ipKa, 'kA', 2),
      cmp('Ik" at MDB-1', ik2, atMdb.r.values.ikMaxKa, 'kA', 2),
    ],
  };
}

function riser(): WorkedExample {
  const p = building('CC-01');
  const check = checkNetworkFeeders(p).risers[0]!;
  const riserRow = p.model.risers[0]!;
  const stored = resultOf(p, riserRow.id, inputsKey(p))?.result;
  const summaries = summariesOf(p);
  const subs = riserRow.feeds.map((id) => summaries.get(id)!);
  const P = subs.reduce((t, s) => t + s.maxDemandKw, 0);
  const Q = subs.reduce((t, s) => t + s.maxDemandKw * Math.tan(Math.acos(s.pf!)), 0);
  const pf = P / Math.hypot(P, Q);
  const ib = (P * 1000) / (SQRT3 * 400 * pf);
  const inA = nextRating(p, ib)!;
  const maker = p.calculation.busbarMaker!;
  const bus = busbarChoices(packOf(p), maker).find((b) => b.ratingA >= inA)!;
  const n = riserRow.feeds.length;
  const k = n > 1 ? (n + 1) / (2 * n) : 1;
  const L = riserRow.lengthM!;
  const sin = Math.sin(Math.acos(pf));
  const volts = (k * SQRT3 * (bus.rHotMohmM * pf + bus.xMohmM * sin) * ib * L) / 1000;
  const pct = (volts / 400) * 100;
  return {
    id: 'riser',
    title: 'Busbar riser - rating and voltage drop',
    source: source('CC-01', `Riser 1 (${maker}, ${L} m) feeding ${n} SMDBs through tap-off boxes`),
    method: [
      'The riser carries the demand of the boards on its tap-offs (the LV-panel category factor is not applied to the riser itself).',
      "Ib as for a three-phase load; In = the lowest standard rating >= Ib; busbar = the smallest rating of the project's manufacturer >= In.",
      'R at 95 °C: R95 = R20 x (1 + 0.00393 x 75). Load spread along the riser: k = (n + 1) / 2n for n tap-offs.',
      'Vd = k x sqrt3 x (R95 cos(phi) + X sin(phi)) x Ib x L / 1000 volts, % of 400 V; limit "Busduct" 2 %.',
      'Each tap-off box gets a breaker = the lowest standard rating >= the Ib of the board it feeds.',
    ],
    inputs: [
      { label: 'Demand on the tap-offs', how: `${n} x ${f(P / n, 1)} kW`, value: P, unit: 'kW' },
      { label: 'Power factor', how: 'combined from the boards', value: pf, digits: 3 },
      {
        label: `${maker} ${bus.ratingA} A`,
        how: 'busbar data (rule pack)',
        value: `R20 ${bus.r20MohmM}, X ${bus.xMohmM} mOhm/m`,
      },
      { label: 'Length', how: 'Busbar Riser Design', value: L, unit: 'm' },
    ],
    steps: [
      {
        label: 'Ib',
        how: `${f(P, 1)} x 1000 / (1.732 x 400 x ${f(pf, 3)})`,
        value: ib,
        unit: 'A',
        digits: 2,
      },
      { label: 'In / busbar', how: `>= ${f(ib)} A`, value: `${inA} A / ${bus.ratingA} A` },
      { label: 'k', how: `(${n} + 1) / (2 x ${n})`, value: k, digits: 3 },
      {
        label: 'R95',
        how: `${bus.r20MohmM} x (1 + 0.00393 x 75)`,
        value: bus.rHotMohmM,
        unit: 'mOhm/m',
        digits: 4,
      },
      {
        label: 'Vd %',
        how: `${f(k, 3)} x 1.732 x (${f(bus.rHotMohmM, 4)} x ${f(pf, 3)} + ${bus.xMohmM} x ${f(sin, 3)}) x ${f(ib)} x ${L} / 1000 / 400 x 100`,
        value: pct,
        unit: '%',
        digits: 3,
      },
    ],
    compare: [
      cmp('Ib', ib, check.ibA, 'A', 2),
      cmp('Busbar rating', bus.ratingA, check.busbar?.ratingA, 'A'),
      cmp('k', k, check.k, '', 3),
      cmp('Riser drop', pct, stored?.values.vdOwnPct ?? check.vdPct, '%', 3),
    ],
  };
}

function cost(): WorkedExample {
  const p = building('CC-01');
  const checks = checkNetworkFeeders(p).risers;
  const priced = riserCosts(p, checks);
  const rate = calcDefault(p, 'riserCostAedPerA')!;
  const rating = checks[0]!.busbar!.ratingA;
  return {
    id: 'cost',
    title: 'Riser cost (Building tab)',
    source: source('CC-01', 'Riser 1'),
    method: [
      'Each riser costs its busbar rating (A) x the rate per ampere (rule pack, 2.2 AED/A; the Lead may change it).',
      'One price per riser whatever its length; transformers and busbar feeders are not included.',
      'Cost = the sum over the risers; "-" while any riser has no busbar rating (no manufacturer, load or length).',
    ],
    inputs: [
      { label: 'Busbar rating', how: 'riser example', value: rating, unit: 'A' },
      { label: 'Rate', how: 'rule pack', value: rate, unit: 'AED/A' },
    ],
    steps: [
      { label: 'Cost', how: `${rating} x ${rate}`, value: rating * rate, unit: 'AED', digits: 2 },
    ],
    compare: [cmp('Cost', rating * rate, priced.totalAed, 'AED', 2)],
  };
}

function transformerLoading(): WorkedExample {
  const p = building('CC-01');
  const pfs = powerFactors(p);
  const summary = capacitySummary(p, summariesOf(p), {
    limitPct: loadingLimitPct(p),
    defaultPf: pfs?.defaultPf ?? null,
  });
  const t = summary.transformers[0]!;
  const lv = p.model.elements.find((e) => e.tag === 'LV-1')!;
  const s = summariesOf(p).get(lv.id)!;
  const kva = s.maxDemandKw / s.pf!;
  return {
    id: 'loading',
    title: 'Transformer loading',
    source: source('CC-01', 'TX-1 1000 kVA'),
    method: [
      'Maximum demand in kVA = MD (kW) / power factor of the load it supplies.',
      'Loaded = MD (kVA) / transformer rating x 100 %. Warning E2801 above rating x limit (100 %, or 80 % when "Limit to 80 %" is ticked).',
      'The project MD over all transformers (each load once) is compared with the plot load allocation (E2802).',
    ],
    inputs: [
      { label: 'MD', how: 'LV-1', value: s.maxDemandKw, unit: 'kW', digits: 2 },
      { label: 'Power factor', how: 'combined', value: s.pf!, digits: 3 },
      { label: 'Rating', how: 'TX-1', value: t.ratingKva!, unit: 'kVA' },
    ],
    steps: [
      {
        label: 'MD kVA',
        how: `${f(s.maxDemandKw)} / ${f(s.pf!, 3)}`,
        value: kva,
        unit: 'kVA',
        digits: 2,
      },
      {
        label: 'Loaded',
        how: `${f(kva)} / ${t.ratingKva} x 100`,
        value: (kva / t.ratingKva!) * 100,
        unit: '%',
        digits: 2,
      },
    ],
    compare: [cmp('Loaded', (kva / t.ratingKva!) * 100, t.loadedPct, '%', 2)],
  };
}

function generator(): WorkedExample {
  const p = building('CC-02');
  const spare = calcDefault(p, 'generatorSpareCapacityPct')!;
  const gpf = calcDefault(p, 'generatorPowerFactor')!;
  const [g] = generatorAnalyses(p, summariesOf(p), { sparePct: spare, pf: gpf });
  const load = Math.max(g!.totals.powerFailureKw, g!.totals.fireKw);
  const required = (load * (1 + spare / 100)) / gpf;
  return {
    id: 'generator',
    title: 'Generator Load Analysis',
    source: source('CC-02', `generator ${g!.tag} (${g!.selectedKva} kVA)`),
    method: [
      'Every load the generator supplies gets three factors: Normal, Case 1 power failure, Case 2 fire (edited on Output).',
      'Starting values: 1.0 for normal and power failure; fire 1.0 for FLS loads and 0 for the others.',
      'Load on the generator = the higher of case 1 and case 2; + spare capacity; / generator power factor = required kVA.',
      'The required kVA is compared with the generator kVA entered in Floor Setup.',
    ],
    inputs: [
      {
        label: 'Case 1 power failure',
        how: 'sum of loads x factors',
        value: g!.totals.powerFailureKw,
        unit: 'kW',
        digits: 2,
      },
      {
        label: 'Case 2 fire',
        how: 'FLS loads only',
        value: g!.totals.fireKw,
        unit: 'kW',
        digits: 2,
      },
      { label: 'Spare capacity', how: 'rule pack', value: spare, unit: '%' },
      { label: 'Generator power factor', how: 'rule pack', value: gpf },
    ],
    steps: [
      {
        label: 'Load',
        how: `max(${f(g!.totals.powerFailureKw)}, ${f(g!.totals.fireKw)})`,
        value: load,
        unit: 'kW',
        digits: 2,
      },
      {
        label: 'Required',
        how: `${f(load)} x ${1 + spare / 100} / ${gpf}`,
        value: required,
        unit: 'kVA',
        digits: 2,
      },
    ],
    compare: [cmp('Required kVA', required, g!.requiredKva, 'kVA', 2)],
  };
}

function pfc(): WorkedExample {
  // CC-01 with a PFC bank fed from LV-1 (user request 10 Nov 2026); every load there is office.
  const p = structuredClone(building('CC-01'));
  const lv = p.model.elements.find((e) => e.tag === 'LV-1')!;
  const item = libraryItem('pfc');
  if (!item || !isPlaceable(item)) throw new Error('No PFC Bank in the library');
  const bank = placeElement(item, {
    id: 'pfc-guide',
    floorId: lv.floorId,
    floorCode: 'GF',
    position: lv.position,
    taken: p.model.elements.map((e) => e.tag),
  });
  p.model.elements.push(bank);
  // Its feeder: the construction of another feeder of the building, from LV-1 to the bank.
  p.model.cables.push({
    ...p.model.cables[0]!,
    id: 'pfc-feeder',
    tag: 'F-PFC',
    from: { elementId: lv.id, port: 'out' },
    to: { elementId: bank.id, port: 'in' },
  });
  const target = calcDefault(p, 'targetPowerFactor')!;
  const s = summariesOf(p).get(lv.id)!;
  const tan = (x: number) => Math.tan(Math.acos(x));
  const kvar = s.maxDemandKw * (tan(s.pf!) - tan(target));
  const ib = (1.5 * kvar * 1000) / (SQRT3 * 400);
  const engine = designFeeders(p).find((d) => d.toId === bank.id)!;
  return {
    id: 'pfc',
    title: 'PFC bank rating',
    source: source('CC-01', `a PFC bank ${bank.tag} fed from LV-1 (office loads)`),
    method: [
      'The bank corrects the panel feeding it: kVAr = sum per demand category of Demand x [tan(acos pf_load) - tan(acos pf_target)].',
      'Demand = connected load x the demand factor the panel applies; pf_load = the DB / load-type power factor; target 0.95 (Lead may change it).',
      'With one category (all office here) this is MD x [tan(acos pf) - tan(acos target)] with the combined power factor of the panel.',
      'Feeder design current Ib = 1.5 x kVAr x 1000 / (sqrt3 x 400 V) (V-08, IEC 60831); breaker and cable are then sized as for any feeder.',
    ],
    inputs: [
      { label: 'MD of LV-1', how: 'load table', value: s.maxDemandKw, unit: 'kW', digits: 2 },
      { label: 'Power factor', how: 'combined, LV-1', value: s.pf!, digits: 4 },
      { label: 'Target power factor', how: 'rule pack', value: target },
    ],
    steps: [
      {
        label: 'kVAr',
        how: `${f(s.maxDemandKw)} x (tan(acos ${f(s.pf!, 4)}) - tan(acos ${target}))`,
        value: kvar,
        unit: 'kVAr',
        digits: 2,
      },
      {
        label: 'Ib',
        how: `1.5 x ${f(kvar)} x 1000 / (1.732 x 400)`,
        value: ib,
        unit: 'A',
        digits: 2,
      },
    ],
    compare: [
      cmp('kVAr', kvar, pfcRating(p, bank.id, powerFactors(p), target).kvar, 'kVAr', 2),
      cmp('Ib', ib, engine.ibA, 'A', 2),
    ],
  };
}

/** Every worked example, by id (the guide's Calculation buttons). */
export const EXAMPLES: Record<string, () => WorkedExample> = {
  length,
  demand,
  'ib-three': ibThreePhase,
  'ib-single': ibSinglePhase,
  'ib-equipment': ibEquipment,
  breaker,
  c1: capacity,
  c2: voltageDrop,
  c6: minimumSize,
  'short-circuit': shortCircuit,
  riser,
  cost,
  loading: transformerLoading,
  pfc,
  generator,
};

export function workedExample(id: string): WorkedExample {
  const make = EXAMPLES[id];
  if (!make) throw new Error(`No worked example ${id}`);
  return make();
}
