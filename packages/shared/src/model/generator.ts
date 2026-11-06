import { z } from 'zod';
import type { Project } from '../project/schema.js';
import type { Element, LoadCategory } from './elements.js';
import { lineKw, ownLines, type LoadSummary, type PhaseKw } from './loads.js';

/**
 * Generator Load Analysis (OI-11; briefing page 8 and manager's answer Q8, 6 Nov 2026): one
 * continuous sheet per generator listing every load downstream of it, panel by panel. The engineer
 * edits three demand factors per load - normal operation, case 1 power failure, case 2 fire - and
 * the tool takes the higher of cases 1 and 2, adds the spare capacity and proposes the generator
 * rating: kVA = kW x (1 + spare) / pf (10 % and 0.8 in the briefing example, rule pack).
 * The one editable report. A load nobody has edited starts at 1.0 for normal and power failure,
 * and for fire at 1.0 when it is FLS, else 0 (10.14: fire mode = FLS loads; user decisions
 * 6 Nov 2026).
 */

const Factor = z.number().min(0).max(1);

/** The engineer's factors and remark for one load (row), kept with the project. */
export const GeneratorFactorSchema = z.object({
  elementId: z.string().min(1),
  normal: Factor,
  powerFailure: Factor,
  fire: Factor,
  remarks: z.string().max(200),
});
export type GeneratorFactor = z.infer<typeof GeneratorFactorSchema>;

export interface GeneratorRow {
  elementId: string;
  from: string;
  to: string;
  /** Load category of the load (its DB / isolator), or of the panel for its own loads. */
  category: LoadCategory;
  kw: PhaseKw;
  totalKw: number;
  factors: Pick<GeneratorFactor, 'normal' | 'powerFailure' | 'fire'>;
  remarks: string;
  /** False while the factors are still the starting values nobody has confirmed. */
  edited: boolean;
  normalKw: number;
  powerFailureKw: number;
  fireKw: number;
}

/** A panel and the loads it feeds; `from` is what feeds the panel. */
export interface GeneratorGroup {
  from: string;
  to: string;
  rows: GeneratorRow[];
}

export interface GeneratorAnalysis {
  generatorId: string;
  tag: string;
  groups: GeneratorGroup[];
  totals: { connectedKw: number; normalKw: number; powerFailureKw: number; fireKw: number };
  /** The higher of case 1 (power failure) and case 2 (fire). */
  loadKw: number;
  governing: 'power failure' | 'fire';
  sparePct: number | null;
  spareKw: number | null;
  requiredKw: number | null;
  pf: number | null;
  requiredKva: number | null;
  /** The generator's kVA entered in Floor Setup; null until entered. */
  selectedKva: number | null;
  /** Selected >= required; null while either is unknown. */
  adequate: boolean | null;
}

/** Starting factors of a load: fire mode runs the FLS loads (10.14). */
export const startingFactors = (category: LoadCategory) => ({
  normal: 1,
  powerFailure: 1,
  fire: category === 'fls' ? 1 : 0,
});

const categoryOf = (e: Element): LoadCategory => ('loadCategory' in e ? e.loadCategory : 'normal');

/** The stored factors with one load's changed (added at `start` the first time). */
export function setGeneratorFactor(
  list: readonly GeneratorFactor[],
  elementId: string,
  patch: Partial<Omit<GeneratorFactor, 'elementId'>>,
  start: Pick<GeneratorFactor, 'normal' | 'powerFailure' | 'fire'> = startingFactors('normal'),
): GeneratorFactor[] {
  const old = list.find((f) => f.elementId === elementId) ?? { elementId, ...start, remarks: '' };
  return [...list.filter((f) => f.elementId !== elementId), { ...old, ...patch }];
}

export function generatorAnalyses(
  project: Pick<Project, 'model'>,
  summaries: ReadonlyMap<string, LoadSummary>,
  options: { sparePct: number | null; pf: number | null },
): GeneratorAnalysis[] {
  const { elements, cables, risers, generatorFactors } = project.model;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const saved = new Map(generatorFactors.map((f) => [f.elementId, f]));
  // What each component feeds: its feeders, and boards on the tap-offs of risers it feeds.
  const children = new Map<string, string[]>();
  const link = (from: string, to: string) =>
    children.set(from, [...(children.get(from) ?? []), to]);
  for (const c of cables) link(c.from.elementId, c.to.elementId);
  for (const r of risers) if (r.fedFromId) for (const id of r.feeds) link(r.fedFromId, id);

  const row = (id: string, from: string, to: string, kw: PhaseKw): GeneratorRow => {
    const f = saved.get(id);
    const category = categoryOf(byId.get(id)!);
    const factors = f
      ? { normal: f.normal, powerFailure: f.powerFailure, fire: f.fire }
      : startingFactors(category);
    const totalKw = kw.L1 + kw.L2 + kw.L3;
    return {
      elementId: id,
      from,
      to,
      category,
      kw,
      totalKw,
      factors,
      remarks: f?.remarks ?? '',
      edited: !!f,
      normalKw: totalKw * factors.normal,
      powerFailureKw: totalKw * factors.powerFailure,
      fireKw: totalKw * factors.fire,
    };
  };

  return elements.flatMap((gen): GeneratorAnalysis[] => {
    if (gen.kind !== 'generator') return [];
    const groups: GeneratorGroup[] = [];
    const seen = new Set<string>([gen.id]);
    // Depth first, as in the briefing example: a panel, its loads, then the panels below it.
    const visit = (id: string, from: string) => {
      const e = byId.get(id)!;
      const below = (children.get(id) ?? []).filter((c) => byId.has(c) && !seen.has(c));
      below.forEach((c) => seen.add(c));
      const panels = below.filter((c) => (children.get(c) ?? []).length > 0);
      const loads = below.filter((c) => !panels.includes(c));
      const rows = loads.flatMap((c) => {
        const s = summaries.get(c);
        return s ? [row(c, e.tag, byId.get(c)!.tag, s.connected)] : [];
      });
      // Loads entered on a panel itself (ways not connected to equipment) are one more row.
      const own = ownLines(e).map(lineKw).reduce(addKw, { L1: 0, L2: 0, L3: 0 });
      if (own.L1 + own.L2 + own.L3 > 0) rows.unshift(row(id, e.tag, `${e.tag} (own loads)`, own));
      if (rows.length) groups.push({ from, to: e.tag, rows });
      for (const p of panels) visit(p, e.tag);
    };
    visit(gen.id, gen.tag);
    const all = groups.flatMap((g) => g.rows);
    const add = (f: (r: GeneratorRow) => number) => all.reduce((t, r) => t + f(r), 0);
    const totals = {
      connectedKw: add((r) => r.totalKw),
      normalKw: add((r) => r.normalKw),
      powerFailureKw: add((r) => r.powerFailureKw),
      fireKw: add((r) => r.fireKw),
    };
    const loadKw = Math.max(totals.powerFailureKw, totals.fireKw);
    const { sparePct, pf } = options;
    const spareKw = sparePct === null ? null : (loadKw * sparePct) / 100;
    const requiredKw = spareKw === null ? null : loadKw + spareKw;
    const requiredKva = requiredKw === null || !pf ? null : requiredKw / pf;
    const selectedKva = 'kvaOverride' in gen ? gen.kvaOverride : null;
    return [
      {
        generatorId: gen.id,
        tag: gen.tag,
        groups,
        totals,
        loadKw,
        governing: totals.fireKw > totals.powerFailureKw ? 'fire' : 'power failure',
        sparePct,
        spareKw,
        requiredKw,
        pf,
        requiredKva,
        selectedKva,
        adequate: selectedKva === null || requiredKva === null ? null : selectedKva >= requiredKva,
      },
    ];
  });
}

const addKw = (a: PhaseKw, b: PhaseKw): PhaseKw => ({
  L1: a.L1 + b.L1,
  L2: a.L2 + b.L2,
  L3: a.L3 + b.L3,
});
