import { suppliedIn, type Element, type Project } from '@neuromep/shared';
import { MAX_PASSES, sizeCables, type SizedBy } from './autosize.js';
import { checkNetworkFeeders, type RiserCheck } from './checks.js';
import { checkAll, type FullCheck, type ProtectionCheck } from './protection.js';

/**
 * The full Cable Size run (10.2): auto-sizing (autosize.ts), every check at the final sizes
 * (C1 - C7, protection.ts), the safety rules C8 / C9 (10.14), "Sized by" and the result status
 * (10.13): Blocked, Awaiting load, Provisional (with its reasons) or Final.
 */

export interface SizedFeeder extends Omit<FullCheck, 'status'> {
  status: FullCheck['status'] | 'final';
  sizedBy: SizedBy | null;
  c8: ProtectionCheck;
  c9: ProtectionCheck;
}

export interface CableSizeOutcome {
  feeders: SizedFeeder[];
  /** Risers (Building tab) at the final sizes: busbar rating, voltage drop. */
  risers: RiserCheck[];
  passes: number;
  converged: boolean;
}

/** Everything upstream of a component through cables and riser tap-offs. */
function ancestorsOf(project: Project, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    const parents = [
      ...project.model.cables.filter((c) => c.to.elementId === cur).map((c) => c.from.elementId),
      ...project.model.risers
        .filter((r) => r.fedFromId && r.feeds.includes(cur))
        .map((r) => r.fedFromId!),
    ];
    for (const p of parents) {
      if (!seen.has(p)) {
        seen.add(p);
        stack.push(p);
      }
    }
  }
  return seen;
}

/**
 * Cables from each FLS load back to the generator (10.14): the feeder into the load, then up
 * through the standby input of an ATS, to the generator.
 */
function flsPathCables(project: Project, fls: Element[]): Set<string> {
  const onPath = new Set<string>();
  const byId = new Map(project.model.elements.map((e) => [e.id, e]));
  for (const load of fls) {
    const stack = [load.id];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const ats = byId.get(cur)?.kind === 'ats';
      for (const c of project.model.cables) {
        if (c.to.elementId !== cur || (ats && c.to.port !== 'standby')) continue;
        onPath.add(c.id);
        stack.push(c.from.elementId);
      }
      for (const r of project.model.risers) {
        if (r.fedFromId && r.feeds.includes(cur)) stack.push(r.fedFromId);
      }
    }
  }
  return onPath;
}

export function cableSize(project: Project): CableSizeOutcome {
  const run = sizeCables(project);
  const checks = checkAll(project, run.sized);
  const byId = new Map(project.model.elements.map((e) => [e.id, e]));
  const onGenerator = suppliedIn(project.model, 'standby');
  const cables = new Map(project.model.cables.map((c) => [c.id, c]));
  const category = (e: Element | undefined) => (e && 'loadCategory' in e ? e.loadCategory : null);
  const fls = project.model.elements.filter((e) => category(e) === 'fls');
  const flsPath = flsPathCables(project, fls);

  const feeders = checks.map((f): SizedFeeder => {
    const to = byId.get(f.toId);
    const cat = category(to);
    const result: SizedFeeder = {
      ...f,
      errors: [...f.errors],
      trace: [...f.trace],
      provisionalReasons: [...f.provisionalReasons],
      status: f.status as SizedFeeder['status'],
      sizedBy: run.sizedBy.get(f.cableId) ?? null,
      c8: { state: 'not-required', detail: 'Normal load.' },
      c9: { state: 'not-required', detail: 'Not on a fire & life-safety path.' },
    };

    // C8 (10.14): essential / FLS need a generator on their path; critical also a UPS.
    if (cat && cat !== 'normal') {
      const generator = onGenerator.has(f.toId);
      const ups = [...ancestorsOf(project, f.toId)].some((id) => byId.get(id)?.kind === 'ups');
      const ok = generator && (cat !== 'critical' || ups);
      const need = cat === 'critical' ? 'a UPS and a generator' : 'a generator';
      result.c8 = {
        state: ok ? 'pass' : 'fail',
        detail: `${to!.tag} is ${cat}: needs ${need} upstream - ${ok ? 'found' : `${generator ? 'no UPS' : 'no generator'} on its path`}.`,
      };
    }
    // C9 (10.14): every cable from an FLS load to the generator should be fire-rated (warning).
    if (flsPath.has(f.cableId)) {
      const cable = cables.get(f.cableId)!;
      const fireRated =
        cable.feederType === 'busbar'
          ? (cable.busbar?.fireRated ?? false)
          : cable.construction.insulation === 'FR';
      result.c9 = fireRated
        ? { state: 'pass', detail: 'Fire-rated, on a fire & life-safety path.' }
        : {
            state: 'fail',
            detail: `${cable.tag} is on a fire & life-safety path to the generator and is not fire-rated (warning).`,
          };
    }

    if (!run.converged && result.size?.from === 'sized') {
      result.errors.push('E2601');
      result.status = 'blocked';
      result.trace.push({ step: 'Sizing', detail: `No stable size after ${MAX_PASSES} passes.` });
    }
    if (
      result.c2 === 'fail' &&
      result.vdUpstreamPct !== null &&
      result.vdLimitPct !== null &&
      result.vdUpstreamPct >= result.vdLimitPct
    ) {
      const board = byId.get(cables.get(f.cableId)!.from.elementId)?.tag ?? 'the source board';
      result.trace.push({
        step: 'C2',
        detail: `C2 cannot pass by sizing this cable: the drop up to ${board} is already ${result.vdUpstreamPct.toFixed(2)} % (limit ${result.vdLimitPct} %). Reduce the drop upstream.`,
      });
    }
    if (result.sizedBy) {
      result.trace.push({ step: 'Sizing', detail: `Sized by ${result.sizedBy}.` });
    }
    // Status (10.13): a check still waiting for breaker data keeps the result Provisional.
    const waiting = [result.c4, result.c5].some((c) => c.state === 'device-data-required');
    if (waiting) result.provisionalReasons.push('device-data-required');
    if (result.status === 'provisional' && result.provisionalReasons.length === 0) {
      result.status = 'final';
    }
    return result;
  });
  return {
    feeders,
    risers: checkNetworkFeeders(project, run.sized).risers,
    passes: run.passes,
    converged: run.converged,
  };
}
