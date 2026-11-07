import {
  cableSize,
  elementResults,
  ENGINE_VERSION,
  feederCosts,
  riserCosts,
  type FeederCost,
  type RiserCost,
} from '@neuromep/engine';
import type { ElementResult, Project } from '@neuromep/shared';

/** What a Cable Size run sends back to the page (WBS 1.7.1). */
export interface EngineReply {
  engineVersion: string;
  results: ElementResult[];
  risers: RiserCost[];
  /** Every feeder at its breaker rating x 2.2 AED (8 Nov 2026). */
  feeders: FeederCost[];
  risersAed: number | null;
  feedersAed: number | null;
  /** Building tab Cost (AED) = risers + feeders; null while an item has no rating. */
  totalAed: number | null;
  converged: boolean;
}

/** The whole Cable Size run (10.2): sizing, every check, results and riser cost. */
export function engineRun(project: Project): EngineReply {
  const outcome = cableSize(project);
  const cost = riserCosts(project, outcome.risers);
  const feeders = feederCosts(project, outcome.feeders);
  return {
    engineVersion: ENGINE_VERSION,
    results: elementResults(project, outcome),
    risers: cost.risers,
    feeders: feeders.feeders,
    risersAed: cost.totalAed,
    feedersAed: feeders.totalAed,
    totalAed:
      cost.totalAed === null || feeders.totalAed === null ? null : cost.totalAed + feeders.totalAed,
    converged: outcome.converged,
  };
}
