import type { Project } from '@neuromep/shared';
import { dewaMinimum, getRulePack } from '@neuromep/rulepacks';
import { cableRating, voltageDrop } from './capacity.js';
import { checkFeeders, type FeederCheck, type Sizes } from './checks.js';
import { tableValue } from './tables.js';

/**
 * Auto-sizing (10.13, #TASK-26). Unlocked cables restart from the DEWA minimum for their breaker
 * (C6) on every run; a cable failing C1 or C2 moves to the smallest standard size - then more
 * parallel runs, up to the maximum (OI-21) - that passes both. Passes go top-down: a cable waits
 * while a cable above it is still changing, so it is not oversized for an upstream drop that is
 * about to shrink. Sizes only grow within a run, so the loop converges; it stops after 50 passes
 * (E2601). Locked cables are validated only. A breaker failing C3 gets a higher fault rating
 * (duty.ts), never a larger cable.
 *
 * Upstream (Option A, user decision 26 Nov 2026): when a feeder cannot meet C2 because the drop
 * before it already uses up its limit, more copper on it cannot help. The sizer then follows the
 * worst supply path up and enlarges the unlocked feeder with the largest drop on it - to the
 * smallest size / runs leaving the feeder below room to pass with its own largest size - and
 * checks again. Everywhere else a failing feeder is enlarged itself, as before. Only calculated
 * sizes change: locked cables and component values are never touched.
 */

export const MAX_PASSES = 50;
/** Parallel runs searched when the rule pack sets no limit. */
export const MAX_RUNS_GUARD = 50;
export type SizedBy = 'C1' | 'C2' | 'C6';

export interface SizingRun {
  sized: Map<string, Sizes>;
  sizedBy: Map<string, SizedBy>;
  passes: number;
  converged: boolean;
  /** Feeders enlarged for the voltage drop of a feeder below: upstream cable id -> that feeder. */
  enlargedFor: Map<string, string>;
}

interface Search {
  /** First size passing C1, first passing C1 and C2, and the largest tried. */
  c1: Sizes | null;
  both: Sizes | null;
  last: Sizes | null;
}

export function sizeCables(project: Project): SizingRun {
  const pack = getRulePack(project.rulePackId!, project.rulePackVersion!);
  const interim = pack.calculationDefaults.find((d) => d.key === 'maxParallelRuns');
  const override = project.calculation.defaultOverrides.maxParallelRuns;
  const maxRuns =
    typeof override === 'number'
      ? override
      : typeof interim?.value === 'number'
        ? interim.value
        : typeof interim?.interimDefault === 'number'
          ? interim.interimDefault
          : MAX_RUNS_GUARD; // no limit (manager 3 Nov 2026); a guard for the search only
  const sizes = pack.devices.cableSizesMm2;
  const site = {
    airC: project.site.ambientAirC.value,
    groundC: project.site.ambientSoilC.value,
    soilResistivity: project.site.soilResistivity.value,
  };
  const cables = new Map(project.model.cables.map((c) => [c.id, c]));

  /** Candidates from `from` upwards: sizes ascending, then one more run, never below C6. */
  const search = (f: FeederCheck, from: Sizes): Search => {
    const cable = cables.get(f.cableId)!;
    const dewa = dewaMinimum(pack.devices, f.device!.ratingA)!;
    const minArea = dewa.sizeMm2 * dewa.runs;
    const phases = f.ibCase === 'single-phase' ? 1 : 3;
    const out: Search = { c1: null, both: null, last: null };
    // C2 cannot be met here when the drop upstream already reaches the limit: more copper on this
    // cable cannot help, so the first size passing C1 is the answer.
    const c2Unreachable =
      f.vdUpstreamPct !== null && f.vdLimitPct !== null && f.vdUpstreamPct >= f.vdLimitPct;
    // A construction with no rated size at all cannot be sized by adding runs (E2101).
    const rated = sizes.some((sz) => cableRating(cable.construction, phases, sz, 1, site).ok);
    if (!rated) return out;
    for (let runs = from.runs; runs <= Math.max(maxRuns, from.runs); runs++) {
      for (const sizeMm2 of sizes) {
        if (runs === from.runs && sizeMm2 < from.sizeMm2) continue;
        if (sizeMm2 * runs < minArea) continue;
        const r = cableRating(cable.construction, phases, sizeMm2, runs, site);
        if (!r.ok) {
          if (r.code === 'E2101') continue; // size not made in this construction
          return out; // missing input: sizing cannot help
        }
        const s = { sizeMm2, runs };
        out.last = s;
        if (r.izA < f.device!.ratingA) continue;
        out.c1 ??= s;
        if (c2Unreachable) return out;
        const v = voltageDrop(cable.construction, phases, sizeMm2, runs, f.ibA!, f.pf!, f.lengthM);
        // A size whose voltage drop cannot be worked out (e.g. PVC above 240 mm�) is not chosen
        // while a verifiable one exists; it stays the C1 fallback only.
        if (!v.ok) continue;
        const limit = f.vdLimitPct;
        const up = f.vdUpstreamPct;
        if (up === null || limit === null || up + v.vcPct <= limit) {
          out.both = s;
          return out;
        }
      }
    }
    return out;
  };

  /**
   * Steps up for an upstream feeder (26 Nov 2026): bigger sizes on its runs, then one more run -
   * never more, so the sizer does not jump to many parallel runs - passing C1, with an earth
   * conductor in the CPC table (a size without one would block, E2101), lower drop than today.
   * Returns the smallest step with an own drop at most `maxPct`, and the lowest-drop step.
   */
  const upSteps = (f: FeederCheck, maxPct: number) => {
    const cable = cables.get(f.cableId)!;
    const cur = f.size!;
    const dewa = dewaMinimum(pack.devices, f.device!.ratingA)!;
    const minArea = dewa.sizeMm2 * dewa.runs;
    const phases = f.ibCase === 'single-phase' ? 1 : 3;
    const ins = cable.construction.insulation === 'PVC' ? 'PVC' : 'XLPE';
    let fit: Sizes | null = null;
    let best: { s: Sizes; pct: number } | null = null;
    for (let runs = cur.runs; runs <= Math.min(cur.runs + 1, Math.max(maxRuns, cur.runs)); runs++) {
      for (const sizeMm2 of sizes) {
        if (runs === cur.runs && sizeMm2 <= cur.sizeMm2) continue;
        if (sizeMm2 * runs < minArea) continue;
        const r = cableRating(cable.construction, phases, sizeMm2, runs, site);
        if (!r.ok || r.izA < f.device!.ratingA) continue;
        const ecc = tableValue('CPC', { size: sizeMm2, PHCON: 'CU', PHINS: ins, CPCINS: 'PVC' });
        if (!ecc.found || typeof ecc.value !== 'number') continue;
        const v = voltageDrop(cable.construction, phases, sizeMm2, runs, f.ibA!, f.pf!, f.lengthM);
        if (!v.ok || v.vcPct >= f.drop!.vcPct) continue;
        if (!fit && v.vcPct <= maxPct) fit = { sizeMm2, runs };
        if (!best || v.vcPct < best.pct) best = { s: { sizeMm2, runs }, pct: v.vcPct };
      }
    }
    return { fit, best };
  };
  /** The lowest drop a feeder can reach with its own runs: its largest rated size. */
  const ownFloorPct = (f: FeederCheck): number => {
    const cable = cables.get(f.cableId)!;
    const phases = f.ibCase === 'single-phase' ? 1 : 3;
    const runs = f.size!.runs;
    for (const sizeMm2 of [...sizes].reverse()) {
      if (!cableRating(cable.construction, phases, sizeMm2, runs, site).ok) continue;
      const v = voltageDrop(cable.construction, phases, sizeMm2, runs, f.ibA!, f.pf!, f.lengthM);
      if (v.ok) return v.vcPct;
    }
    return 0;
  };

  // Feeders directly above each feeder (into its source board, or into the board feeding its riser).
  const parents = (checks: FeederCheck[]) => {
    const into = new Map<string, string[]>();
    for (const f of checks) into.set(f.toId, [...(into.get(f.toId) ?? []), f.cableId]);
    const riserSource = new Map<string, string>();
    for (const r of project.model.risers) {
      if (r.fedFromId) for (const id of r.feeds) riserSource.set(id, r.fedFromId);
    }
    return (cableId: string): string[] => {
      const fromId = cables.get(cableId)!.from.elementId;
      const board = into.has(fromId) ? fromId : riserSource.get(fromId);
      return board ? (into.get(board) ?? []) : [];
    };
  };
  const ancestors = (up: (id: string) => string[], id: string) => {
    const seen = new Set<string>();
    const stack = [...up(id)]; // a copy: up() returns the lookup's own list
    while (stack.length) {
      const next = stack.pop()!;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(...up(next));
      }
    }
    return seen;
  };

  const sized = new Map<string, Sizes>();
  const enlargedFor = new Map<string, string>();
  let passes = 0;
  let converged = false;
  while (passes < MAX_PASSES) {
    passes++;
    const checks = checkFeeders(project, sized);
    const up = parents(checks);
    const failing = checks.filter(
      (f) =>
        f.size &&
        f.size.from !== 'locked' &&
        f.device &&
        f.ibA !== null &&
        f.pf !== null &&
        // A failing check, or a size the construction does not have (E2101, e.g. 4C 630 mm�).
        (f.c1 === 'fail' || f.c2 === 'fail' || (f.c1 === 'blocked' && f.errors.includes('E2101'))),
    );
    // Propose a size for every failing cable, then apply top-down: a cable waits while a cable
    // above it is about to change (whatever the list order), so it is never sized against an
    // upstream drop this pass will reduce. A cable above that cannot change (blocked data) does
    // not hold it back.
    const proposals = new Map<string, Sizes>();
    for (const f of failing) {
      const found = search(f, f.size!);
      const next = found.both ?? found.c1 ?? found.last;
      if (next && (next.sizeMm2 !== f.size!.sizeMm2 || next.runs !== f.size!.runs)) {
        proposals.set(f.cableId, next);
      }
    }
    // C2 out of reach below: enlarge the feeder with the largest drop on the worst path above.
    const byId = new Map(checks.map((f) => [f.cableId, f]));
    for (const f of failing) {
      if (
        f.c2 !== 'fail' ||
        f.vdUpstreamPct === null ||
        f.vdLimitPct === null ||
        f.vdUpstreamPct < f.vdLimitPct
      ) {
        continue;
      }
      // Worst path: at each board the incoming feeder with the highest total drop (10.13).
      const path: FeederCheck[] = [];
      const seen = new Set<string>();
      let next = up(f.cableId);
      while (next.length) {
        const worst = next
          .map((id) => byId.get(id))
          .filter((c): c is FeederCheck => !!c && !seen.has(c.cableId))
          .sort((a, b) => (b.vdTotalPct ?? -1) - (a.vdTotalPct ?? -1))[0];
        if (!worst) break;
        seen.add(worst.cableId);
        path.push(worst);
        next = up(worst.cableId);
      }
      // Wait while a feeder on the path is still changing this pass (top-down, as above).
      if (path.some((a) => proposals.has(a.cableId))) continue;
      let need = f.vdUpstreamPct + ownFloorPct(f) - f.vdLimitPct; // drop to remove above
      const candidates = path
        .filter(
          (a) =>
            a.size &&
            a.size.from !== 'locked' &&
            a.device &&
            a.ibA !== null &&
            a.pf !== null &&
            a.drop,
        )
        .sort((a, b) => b.drop!.vcPct - a.drop!.vcPct);
      // Largest drop first; a feeder that cannot remove it all takes its lowest-drop step and the
      // next one takes the rest. All or nothing: when the path cannot remove enough, nothing
      // changes and the feeder keeps its C2 failure with the advice (cableSize.ts).
      const steps = new Map<string, Sizes>();
      for (const a of candidates) {
        if (need <= 0) break;
        const { fit, best } = upSteps(a, a.drop!.vcPct - need);
        if (fit) {
          steps.set(a.cableId, fit);
          need = 0;
        } else if (best) {
          steps.set(a.cableId, best.s);
          need -= a.drop!.vcPct - best.pct;
        }
      }
      if (need > 0) continue;
      for (const [id, s] of steps) {
        proposals.set(id, s);
        enlargedFor.set(id, f.cableId);
      }
    }
    const changed = new Set<string>();
    for (const [id, next] of proposals) {
      if ([...ancestors(up, id)].some((a) => proposals.has(a))) continue;
      sized.set(id, next);
      changed.add(id);
    }
    if (changed.size === 0) {
      converged = true;
      break;
    }
  }

  // Sized by (10.13): the check that decided each unlocked size, searched again from C6.
  const sizedBy = new Map<string, SizedBy>();
  for (const f of checkFeeders(project, sized)) {
    if (!f.size || f.size.from === 'locked' || !f.device || f.ibA === null || f.pf === null) {
      continue;
    }
    const dewa = dewaMinimum(pack.devices, f.device.ratingA);
    if (!dewa) continue;
    const start = { sizeMm2: dewa.sizeMm2, runs: dewa.runs };
    const same = (a: Sizes | null) =>
      !!a && a.sizeMm2 === f.size!.sizeMm2 && a.runs === f.size!.runs;
    if (enlargedFor.has(f.cableId) && f.size.from === 'sized') {
      const s = search(f, start);
      if (!same(s.c1) && !same(s.both)) {
        sizedBy.set(f.cableId, 'C2');
        continue;
      }
    }
    if (same(start)) sizedBy.set(f.cableId, 'C6');
    else {
      const s = search(f, start);
      sizedBy.set(f.cableId, same(s.c1) ? 'C1' : 'C2');
    }
  }
  for (const id of [...enlargedFor.keys()]) if (sizedBy.get(id) !== 'C2') enlargedFor.delete(id);
  return { sized, sizedBy, passes, converged, enlargedFor };
}
