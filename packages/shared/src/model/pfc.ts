import type { DemandCategory, LoadTypeCode } from '../project/enums.js';
import type { Project } from '../project/schema.js';
import type { Element } from './elements.js';
import {
  categoryOf,
  DEMAND_BOARDS,
  lineKw,
  MAIN_BOARDS,
  ownLines,
  ownPf,
  SECOND_BOARDS,
  type LoadPowerFactors,
} from './loads.js';

/**
 * PFC bank rating (design doc 10.15; components workbook "PFC" column, user request 10 Nov 2026):
 * a PFC bank is fed from a panel, and corrects that panel's load to the target power factor.
 *
 *   kVAr (per demand category of the panel) = sum of Demand(type) x [tan(acos pf_load) - tan(acos pf_target)]
 *
 * Demand = connected load x the demand factor the panel applies (Dubai method: the category
 * factor at an LV panel / MDB, the second-level factor at an SMDB; manual method: the load-type
 * factor or the panel's override). The power factor of a load is its DB's / equipment's own, else
 * its load type's (12.2). Standard bank sizes are open (OI-20): the calculated value is shown.
 */

export interface PfcCategoryRow {
  category: DemandCategory | 'none';
  /** Maximum demand of the category at the panel (kW). */
  demandKw: number;
  /** Reactive power to compensate (kVAr); negative when the loads are above the target. */
  kvar: number;
}

export interface PfcRating {
  pfcId: string;
  /** The panel feeding the bank (its first feeder); null while nothing feeds it. */
  panelId: string | null;
  targetPf: number | null;
  rows: PfcCategoryRow[];
  /** Bank rating (kVAr), never below 0; null without a panel, a target or a load power factor. */
  kvar: number | null;
  /** Tags of loads with no power factor (the rating is not calculated, E2003). */
  missingPf: string[];
}

const tanOf = (pf: number) => (pf >= 1 ? 0 : Math.tan(Math.acos(pf)));

/** The rating of one PFC bank from the demand of the panel feeding it. */
export function pfcRating(
  project: Pick<Project, 'model' | 'calculation'>,
  pfcId: string,
  powerFactors: LoadPowerFactors | null,
  targetPf: number | null,
): PfcRating {
  const { elements, cables, risers } = project.model;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const feeder = cables.find((c) => c.to.elementId === pfcId);
  const panel = feeder ? byId.get(feeder.from.elementId) : undefined;
  const none: PfcRating = {
    pfcId,
    panelId: panel?.id ?? null,
    targetPf,
    rows: [],
    kvar: null,
    missingPf: [],
  };
  if (!panel) return none;

  // Everything the panel feeds: feeders, riser tap-offs and linked equipment (as loadSummaries).
  const children = new Map<string, Element[]>();
  const link = (from: string, to: string) => {
    const e = byId.get(to);
    if (e) children.set(from, [...(children.get(from) ?? []), e]);
  };
  for (const c of cables) link(c.from.elementId, c.to.elementId);
  for (const r of risers ?? []) if (r.fedFromId) for (const id of r.feeds) link(r.fedFromId, id);
  for (const e of elements) if (e.kind === 'equipment' && e.fedFromId) link(e.fedFromId, e.id);
  const below: Element[] = [];
  const seen = new Set<string>();
  const walk = (e: Element) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    below.push(e);
    for (const c of children.get(e.id) ?? []) walk(c);
  };
  walk(panel);

  // The demand factor the panel applies to a load (loads.ts, once at the board).
  const calc = project.calculation;
  const method = calc.demandMethod ?? 'dubai-non-emaar';
  const factorOf = (category: DemandCategory | 'none', type: LoadTypeCode): number => {
    if (method !== 'manual') {
      if (MAIN_BOARDS.has(panel.kind)) {
        return category === 'none' ? 1 : (calc.demandFactors.byCategory[category].value ?? 1);
      }
      if (SECOND_BOARDS.has(panel.kind)) return calc.demandFactors.secondLevel?.value ?? 1;
      return 1;
    }
    if (!DEMAND_BOARDS.has(panel.kind)) return 1;
    const override =
      'demandFactorOverrides' in panel ? panel.demandFactorOverrides[type] : undefined;
    return override ?? calc.demandFactors.byLoadType[type].value ?? 1;
  };

  const rows = new Map<DemandCategory | 'none', PfcCategoryRow>();
  const missing = new Set<string>();
  for (const e of below) {
    for (const line of ownLines(e)) {
      const p = lineKw(line);
      const kw = p.L1 + p.L2 + p.L3;
      if (kw <= 0) continue;
      const pf = ownPf(e) ?? powerFactors?.byType[line.loadType] ?? powerFactors?.defaultPf ?? null;
      if (!pf) {
        missing.add(e.tag);
        continue;
      }
      const category = categoryOf(e);
      const demand = kw * factorOf(category, line.loadType);
      const row = rows.get(category) ?? { category, demandKw: 0, kvar: 0 };
      row.demandKw += demand;
      row.kvar += targetPf ? demand * (tanOf(pf) - tanOf(targetPf)) : 0;
      rows.set(category, row);
    }
  }
  const list = [...rows.values()];
  const total = list.reduce((t, r) => t + r.kvar, 0);
  return {
    ...none,
    rows: list,
    missingPf: [...missing],
    kvar: !targetPf || missing.size ? null : Math.max(0, total),
  };
}
