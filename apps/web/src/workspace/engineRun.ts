import {
  cableSize,
  elementResults,
  ENGINE_VERSION,
  riserCosts,
  type RiserCost,
} from '@neuromep/engine';
import type { ElementResult, Project } from '@neuromep/shared';

/** What a Cable Size run sends back to the page (WBS 1.7.1). */
export interface EngineReply {
  engineVersion: string;
  results: ElementResult[];
  risers: RiserCost[];
  /** Building tab Cost (AED); null while a riser has no busbar rating. */
  totalAed: number | null;
  converged: boolean;
}

/** The whole Cable Size run (10.2): sizing, every check, results and riser cost. */
export function engineRun(project: Project): EngineReply {
  const outcome = cableSize(project);
  const cost = riserCosts(project, outcome.risers);
  return {
    engineVersion: ENGINE_VERSION,
    results: elementResults(project, outcome),
    risers: cost.risers,
    totalAed: cost.totalAed,
    converged: outcome.converged,
  };
}
