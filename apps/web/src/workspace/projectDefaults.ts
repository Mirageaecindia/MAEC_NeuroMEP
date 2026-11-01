import type { Project } from '@neuromep/shared';
import { getRulePack } from '@neuromep/rulepacks';

/** Default load power factor of the project's rule pack, or null without one. */
export function defaultPf(project: Project): number | null {
  if (!project.rulePackId || !project.rulePackVersion) return null;
  const v = getRulePack(project.rulePackId, project.rulePackVersion).calculationDefaults.find(
    (d) => d.key === 'defaultLoadPowerFactor',
  )?.value;
  return typeof v === 'number' ? v : null;
}

/**
 * Cable length allowance (12.2): the Technical Lead's override, else the rule-pack value, else its
 * interim default (OI-17: 10 %), labelled interim. Null without a rule pack.
 */
export function lengthAllowance(project: {
  rulePackId: string | null;
  rulePackVersion: string | null;
  calculation: { defaultOverrides: Record<string, number | string> };
}): { pct: number; interim: boolean } | null {
  const override = project.calculation.defaultOverrides.cableLengthAllowancePct;
  if (typeof override === 'number') return { pct: override, interim: false };
  if (!project.rulePackId || !project.rulePackVersion) return null;
  const d = getRulePack(project.rulePackId, project.rulePackVersion).calculationDefaults.find(
    (x) => x.key === 'cableLengthAllowancePct',
  );
  if (typeof d?.value === 'number') return { pct: d.value, interim: false };
  if (typeof d?.interimDefault === 'number') return { pct: d.interimDefault, interim: true };
  return null;
}
