import type { LengthRule, LoadPowerFactors, Project } from '@neuromep/shared';
import { getRulePack, loadPowerFactors } from '@neuromep/rulepacks';

/** Power factors per load type and the default (Lead override, else rule pack); null without one. */
export function powerFactors(project: Project): LoadPowerFactors | null {
  if (!project.rulePackId || !project.rulePackVersion) return null;
  return loadPowerFactors(project, getRulePack(project.rulePackId, project.rulePackVersion));
}

/** Default load power factor of the project (Lead override, else rule pack), or null without one. */
export function defaultPf(project: Project): number | null {
  return powerFactors(project)?.defaultPf ?? null;
}

/**
 * How cable lengths are built (12.2, amended 3 Nov 2026): the Technical Lead's override, else the
 * rule-pack value, else its interim default (labelled interim). `additionM` is the fixed length
 * added to every measured cable (5 m in the Dubai pack). Null without a rule pack.
 */
export function lengthRule(project: {
  rulePackId: string | null;
  rulePackVersion: string | null;
  calculation: { defaultOverrides: Record<string, number | string> };
}): (LengthRule & { interim: boolean }) | null {
  if (!project.rulePackId || !project.rulePackVersion) return null;
  const defaults = getRulePack(project.rulePackId, project.rulePackVersion).calculationDefaults;
  const pick = (key: string) => {
    const o = project.calculation.defaultOverrides[key];
    if (typeof o === 'number') return { v: o, interim: false };
    const d = defaults.find((x) => x.key === key);
    if (typeof d?.value === 'number') return { v: d.value, interim: false };
    if (typeof d?.interimDefault === 'number') return { v: d.interimDefault, interim: true };
    return null;
  };
  const pct = pick('cableLengthAllowancePct');
  const add = pick('cableLengthAdditionM');
  return { allowancePct: pct?.v ?? 0, additionM: add?.v ?? null, interim: !!pct?.interim };
}
