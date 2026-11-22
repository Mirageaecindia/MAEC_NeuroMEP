import {
  CHECK_LABELS,
  ERROR_CATALOGUE,
  fireRatedFlags,
  inputsKey,
  onPlanOf,
  resultOf,
  unlinkedEquipment,
  type CheckCode,
  type Project,
} from '@neuromep/shared';

/**
 * Issues of the right panel (user request 18 Nov 2026): one short line each - code, the component
 * or the connection (feeder: from -> to) and a few words - with the full message on hover. A
 * click shows the item on its plan (`floorId`; null = a feeder between floors, drawn in the
 * Building tab).
 */
export interface PanelIssue {
  key: string;
  code: string;
  targetId: string;
  /** The plan the item is drawn on; null for a feeder between floors. */
  floorId: string | null;
  /** Floors the item touches (a feeder between floors: both ends). */
  onFloors: string[];
  /** The component tag, or the feeder tag with its two ends. */
  label: string;
  /** A few words. */
  text: string;
  /** The full message and what to do (tooltip). */
  detail: string;
}

const BLOCKING = new Map<string, string>(
  ERROR_CATALOGUE.filter((e) => e.effect === 'blocks').map((e) => [e.code, e.message]),
);
const SHORT: Record<string, string> = {
  W1803: 'not linked to an isolator',
  W2701: 'FLS feeder not fire-rated',
  W2702: 'fire-rated, no FLS load below',
  E2001: 'no breaker large enough',
  E2003: 'Ib unknown - data missing',
  E2101: 'size outside the table',
  E2102: 'derating factor missing',
};

export function panelIssues(p: Project): PanelIssue[] {
  const els = new Map(p.model.elements.map((e) => [e.id, e]));
  const tag = (id: string) => els.get(id)?.tag ?? '?';
  const cableInfo = (id: string) => {
    const c = p.model.cables.find((x) => x.id === id);
    if (!c) return null;
    const floorId = els.get(c.from.elementId)?.floorId ?? null;
    return {
      label: `${c.tag} (${tag(c.from.elementId)} → ${tag(c.to.elementId)})`,
      floorId: floorId && onPlanOf(c, p.model.elements, floorId) ? floorId : null,
      onFloors: [c.from.elementId, c.to.elementId].flatMap((id) => els.get(id)?.floorId ?? []),
    };
  };
  const issues: PanelIssue[] = [];
  for (const e of unlinkedEquipment(p.model)) {
    issues.push({
      key: `W1803-${e.id}`,
      code: 'W1803',
      targetId: e.id,
      floorId: e.floorId,
      onFloors: [e.floorId],
      label: e.tag,
      text: SHORT.W1803!,
      detail: `${e.tag} is not connected to a panel: choose its isolator or connection unit in Fed from.`,
    });
  }
  for (const f of fireRatedFlags(p.model)) {
    const c = cableInfo(f.cableId);
    if (!c) continue;
    issues.push({
      key: `${f.code}-${f.cableId}`,
      code: f.code,
      targetId: f.cableId,
      floorId: c.floorId,
      onFloors: c.onFloors,
      label: c.label,
      text: SHORT[f.code]!,
      detail: `${f.message}. ${f.fix}`,
    });
  }
  // The last Cable Size: blocked feeders and failing checks (results out of date are left out).
  const key = inputsKey(p);
  for (const cable of p.model.cables) {
    const found = resultOf(p, cable.id, key);
    if (!found || found.outOfDate) continue;
    const r = found.result;
    const c = cableInfo(cable.id)!;
    if (r.status === 'blocked') {
      const code = r.errors.find((x) => BLOCKING.has(x)) ?? r.errors[0] ?? 'Blocked';
      const ib = [...r.trace].reverse().find((t) => t.step === 'Ib');
      // What exactly is missing (18 Nov 2026: "Derating factor missing" alone did not say):
      // the blocked check's own reason, e.g. "Enter the number of grouped circuits."
      const check = Object.values(r.checks).find((v) => v?.state === 'blocked' && v.detail);
      const reason = r.values.ibA === null && ib ? ib.detail : check?.detail;
      const meaning = BLOCKING.get(code) ?? code;
      issues.push({
        key: `blocked-${cable.id}`,
        code,
        targetId: cable.id,
        floorId: c.floorId,
        onFloors: c.onFloors,
        label: c.label,
        text: reason && reason.length <= 70 ? reason.replace(/\.$/, '') : (SHORT[code] ?? meaning),
        detail: reason ? `${meaning} (${code}): ${reason}` : meaning,
      });
    }
    for (const [check, v] of Object.entries(r.checks) as [
      CheckCode,
      { state: string; detail?: string },
    ][]) {
      if (v?.state !== 'fail') continue;
      issues.push({
        key: `${check}-${cable.id}`,
        code: check,
        targetId: cable.id,
        floorId: c.floorId,
        onFloors: c.onFloors,
        label: c.label,
        text: `${CHECK_LABELS[check]} fails`,
        detail: v.detail ?? `${check} ${CHECK_LABELS[check]} fails`,
      });
    }
  }
  return issues;
}

/** The issues of the selected item, else of everything drawn on the floor. */
export function issuesInScope(
  p: Project,
  issues: PanelIssue[],
  scope: { selectedId: string | null; floorId: string | null },
): PanelIssue[] {
  if (scope.selectedId) {
    // A component: its own issues and those of its incoming feeder.
    const incoming = p.model.cables
      .filter((c) => c.to.elementId === scope.selectedId)
      .map((c) => c.id);
    return issues.filter((i) => i.targetId === scope.selectedId || incoming.includes(i.targetId));
  }
  return issues.filter((i) => scope.floorId !== null && i.onFloors.includes(scope.floorId));
}
