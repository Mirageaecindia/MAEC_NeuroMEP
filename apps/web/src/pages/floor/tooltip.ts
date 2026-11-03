import {
  cableLength,
  fedFrom,
  resultOf,
  type LengthRule,
  type LoadSummary,
  type Project,
} from '@neuromep/shared';
import { resultFigures } from './SizingResult';

const val = (v: number | null | undefined, unit: string) => (v == null ? '-' : `${v} ${unit}`);
const kw = (v: number | null | undefined) => (v == null ? '-' : `${v.toFixed(1)} kW`);

/**
 * Hover tooltip of a component or feeder (FR-36, 12.5): entered data and live loads, and calculated
 * values from the last Cable Size run, marked Out of date when stale; voltage drop to 2 decimals.
 * Values not in the model yet show '-'.
 */
export function tooltipLines(
  project: Project,
  summaries: Map<string, LoadSummary>,
  length: LengthRule,
  id: string,
): string[] | null {
  const { elements, cables } = project.model;
  const found = resultOf(project, id);
  const figures = found ? resultFigures(found.result) : null;
  const stale = found?.outOfDate ? ['Results out of date - press Cable Size'] : [];
  const tagOf = (eid: string) => elements.find((e) => e.id === eid)?.tag ?? '?';

  const cable = cables.find((c) => c.id === id);
  if (cable) {
    const r = found?.result;
    return [
      `${cable.tag} - ${cable.feederType === 'busbar' ? 'Busbar' : 'Cable'}`,
      cable.feederType === 'busbar'
        ? `Rating: ${val(r?.device?.ratingA, 'A')} TPN+E, IP ${cable.busbar?.ipRating ?? '-'}`
        : `Size: ${figures?.size ?? '-'}`,
      `Upstream breaker: ${val(r?.values.inA, 'A')}`,
      `Corrected ampacity: ${val(r?.values.izA, 'A')}`,
      `From ${tagOf(cable.from.elementId)} to ${tagOf(cable.to.elementId)}`,
      `Length: ${cableLength(cable, length).totalM.toFixed(2)} m`,
      `Vd circuit: ${figures?.vdOwn ?? '-'} · Vd total: ${figures?.vdTotal ?? '-'}`,
      ...stale,
    ];
  }

  const e = elements.find((x) => x.id === id);
  if (!e) return null;
  const s = summaries.get(e.id);
  const from = `Fed from: ${fedFrom(e, project.model) ?? '-'}`;
  const lines: string[] = [e.tag];
  switch (e.kind) {
    case 'transformer':
      lines.push(
        `Rating: ${val(e.kva, 'kVA')} · %Z ${val(e.ukPct, '%')}`,
        `Primary: ${val(e.primaryV, 'V')}`,
        `Short-circuit: ${val(found?.result.values.ikMaxKa, 'kA')}`,
        `TCL ${kw(s?.connectedKw)} · MD ${kw(s?.maxDemandKw)} · Standby ${kw(s?.standbyKw)}`,
      );
      break;
    case 'generator':
    case 'ups':
      lines.push(
        `Rating: ${val(e.kvaOverride, 'kVA')} · %X"d ${val(e.xdSubtransientPct, '%')}`,
        `Short-circuit: ${val(e.sustainedScKa, 'kA')}`,
        `TCL ${kw(s?.connectedKw)} · MD ${kw(s?.maxDemandKw)}`,
      );
      break;
    case 'tap-off-box':
    case 'isolator':
    case 'connection-unit':
    case 'motor':
      lines.push(from, `Vd total: ${figures?.vdTotal ?? '-'}`);
      break;
    case 'eb-utility':
    case 'ats':
    case 'pfc-bank':
    case 'busbar':
      lines.push(from);
      break;
    default:
      // Boards: LV Panel / MDB / SMDB / MCC / DB.
      lines.push(
        `TCL ${kw(s?.connectedKw)} · Incomer ${figures?.breaker ?? '-'} · ${e.poles}`,
        ...(e.description ? [e.description] : []),
        from,
      );
  }
  return [...lines, ...stale];
}
