import {
  canOpenPage,
  hasModel,
  modelImpact,
  type ModelImpact,
  type Project,
} from '@neuromep/shared';
import type { ProjectAction } from './projectReducer';

/** One Page 1 calculation input being changed: what the confirmation and the audit log show. */
export interface EarlierPageChange {
  /** Field path, e.g. `site.ambientAirC` (audit key). */
  key: string;
  label: string;
  from: number | string | null;
  to: number | string | null;
}

const onOff = (b: boolean) => (b ? 'ticked' : 'not ticked');
const floorsText = (c: { typicals: number | null; basements: number | null }) =>
  `${c.typicals ?? 0} floors, ${c.basements ?? 0} basements`;

/**
 * The Page 1 inputs that feed the calculations (design doc Section 9: ambient temperature, demand
 * factors, floors …). Name, client and other descriptive fields are not among them.
 */
export function describeChange(project: Project, action: ProjectAction): EarlierPageChange | null {
  switch (action.type) {
    case 'site':
      return {
        key: `site.${action.key}`,
        label:
          action.key === 'ambientAirC'
            ? 'ambient air temperature'
            : action.key === 'ambientSoilC'
              ? 'ambient soil temperature'
              : 'soil thermal resistivity',
        from: project.site[action.key].value,
        to: action.value,
      };
    case 'altitude':
      return {
        key: 'site.altitudeM',
        label: 'altitude',
        from: project.site.altitudeM,
        to: action.value,
      };
    case 'region':
      return {
        key: 'calculation.region',
        label: 'region',
        from: project.calculation.region,
        to: action.region,
      };
    case 'upstreamMva':
      return {
        key: 'calculation.upstreamFaultMva',
        label: 'upstream short-circuit capacity',
        from: project.calculation.upstreamFaultMva,
        to: action.value,
      };
    case 'check':
      return {
        key: `calculation.checks.${action.check}`,
        label: 'the checks calculated',
        from: onOff(project.calculation.checks[action.check]),
        to: onOff(action.enabled),
      };
    case 'demandFactor':
      return {
        key: `calculation.demandFactors.${action.table}.${action.key}`,
        label: 'a demand factor',
        from:
          (
            project.calculation.demandFactors[action.table] as Record<
              string,
              { value: number | null }
            >
          )[action.key]?.value ?? null,
        to: action.value,
      };
    case 'applyRegistry':
      return {
        key: 'building.counts',
        label: 'the number of floors',
        from: floorsText(project.building.counts),
        to: floorsText(action.counts),
      };
    case 'details':
      return action.patch.plotLoad
        ? {
            key: 'details.plotLoad',
            label: 'plot load allocation',
            from: project.details.plotLoad.value,
            to: action.patch.plotLoad.value,
          }
        : null;
    default:
      return null;
  }
}

/**
 * A change needs confirmation (Section 9) when the project has moved past Import File, something
 * has been modelled, and the change feeds the calculations. Returns what to show, or null.
 */
export function confirmationFor(
  project: Project,
  action: ProjectAction,
): { change: EarlierPageChange; impact: ModelImpact } | null {
  if (!canOpenPage(project.meta, 'modelling')) return null;
  const impact = modelImpact(project);
  if (!hasModel(impact)) return null;
  const change = describeChange(project, action);
  return change && change.from !== change.to ? { change, impact } : null;
}
