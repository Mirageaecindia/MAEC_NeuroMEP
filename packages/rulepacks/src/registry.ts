import type { Region } from '@neuromep/shared';
import dubaiV1 from '../dubai/v1.json' with { type: 'json' };
import { RulePackSchema, type RulePack } from './schema.js';

/** All rule packs shipped with this build, validated on load. */
export const RULE_PACKS: readonly RulePack[] = [RulePackSchema.parse(dubaiV1)];

/** Region availability (FR-04, D-09): a region is active when it has a rule pack. */
export const REGION_RULE_PACKS: Record<Region, { packId: string; version: string } | null> = {
  dubai: { packId: 'dubai', version: '1.0.0' },
  'abu-dhabi': null,
  others: null,
};

export const ACTIVE_REGIONS: readonly Region[] = (
  Object.keys(REGION_RULE_PACKS) as Region[]
).filter((r) => REGION_RULE_PACKS[r] !== null);

export function getRulePack(id: string, version: string): RulePack {
  const pack = RULE_PACKS.find((p) => p.id === id && p.version === version);
  if (!pack) throw new Error(`Rule pack ${id} v${version} is not available.`);
  return pack;
}

/** The current rule pack of a region, or null when the region has none yet. */
export function rulePackForRegion(region: Region): RulePack | null {
  const ref = REGION_RULE_PACKS[region];
  return ref ? getRulePack(ref.packId, ref.version) : null;
}
