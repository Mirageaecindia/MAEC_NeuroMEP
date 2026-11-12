import { cableSize, elementResults, ENGINE_VERSION } from '@neuromep/engine';
import { applyRulePackDefaults, loadPowerFactors, rulePackForRegion } from '@neuromep/rulepacks';
import {
  closeRoute,
  createEmptyProject,
  drawBuildingFeeder,
  drawCable,
  ElementSchema,
  generateRegistry,
  inputsKey,
  isPlaceable,
  libraryItem,
  loadSummaries,
  mergeRun,
  placeElement,
  revitExchange,
  twoPointMetresPerUnit,
  type Cable,
  type CableConstruction,
  type Element,
  type ModelPoint,
  type Project,
  type RevitExchange,
  type RevitReferencePoint,
} from '@neuromep/shared';
import { lengthRule } from '../workspace/projectDefaults';

/**
 * #TASK-33 Revit exchange samples (user request 12 Nov 2026): a building modelled on real floor
 * plan PDFs exactly as an engineer would in Floor Setup - components placed on the plan, feeders
 * drawn along corners, loads entered - then Cable Size on the whole project (the app's engine),
 * then the exchange package. Positions are given in PDF points read off the plan (origin
 * bottom-left, y up) and stored in metres through the plan's two-point calibration, as the app
 * does. Every load and setting typed here is sample data, not a design value.
 */

export const SAMPLE_RUN_AT = '2026-11-12T08:00:00.000Z';
const pack = rulePackForRegion('dubai')!;

export type Pt = [number, number];

/** A floor plan sheet: page size and a two-point calibration read off its scale bar or grid. */
export interface PlanSheet {
  fileName: string;
  widthPt: number;
  heightPt: number;
  calibration: { a: Pt; b: Pt; metres: number };
  /** Grid crossings with their Revit coordinates, when the Revit team gives them. */
  alignment?: RevitReferencePoint[];
  /** /Rotate of the page (degrees clockwise): the sheet is shown turned, coordinates are not. */
  rotationDeg?: number;
}

export interface SampleBuilder {
  project: Project;
  place(key: string, floor: string, tag: string, at: Pt, patch?: Record<string, unknown>): Element;
  /** A feeder drawn on the plan from one component to another through the corners (pt). */
  feed(
    from: string,
    to: string,
    corners: Pt[],
    construction: CableConstruction,
    port?: 'in' | 'normal' | 'standby',
  ): Cable;
  /** A feeder between floors, drawn in the Building tab with a typed length (A-21). */
  between(from: string, to: string, lengthM: number, construction: CableConstruction): Cable;
  riser(from: string, lengthM: number, feeds: string[]): void;
  /** Cable Size on the whole project, then the exchange package. */
  finish(): { project: Project; exchange: RevitExchange };
}

export function sampleBuilder(args: {
  id: string;
  name: string;
  floors: { basements: number; grounds: number; podiums: number; typicals: number };
  plans: Record<string, PlanSheet>;
  /** Floor names as the engineer renamed them (Building tab), by code. */
  names?: Record<string, string>;
}): SampleBuilder {
  let project = createEmptyProject({ id: args.id, userId: 'u-lead', now: SAMPLE_RUN_AT });
  project.details = {
    name: args.name,
    location: 'Dubai',
    clientName: 'MAEC - Revit exchange sample (test data)',
    plotRef: 'Revit exchange sample',
    designStage: 'SD',
    revision: 'A',
    category: 'OFFICE',
    plotLoad: { value: 2500, unit: 'kVA' },
  };
  project.calculation.region = 'dubai';
  project.calculation.upstreamFaultMva = 350;
  project.calculation.demandMethod = 'dubai-non-emaar';
  project.calculation.busbarMaker = 'gersan';
  project.building.counts = args.floors;
  let n = 0;
  project.building.floors = generateRegistry(args.floors, [], () => `f${++n}`).floors.map((f) => ({
    ...f,
    name: args.names?.[f.code] ?? f.name,
  }));
  project = applyRulePackDefaults(project, pack);
  const p = project;

  // Each plan with its two-point calibration, as the engineer does on first display (A-04).
  const mpp = new Map<string, number>();
  for (const [code, sheet] of Object.entries(args.plans)) {
    const f = p.building.floors.find((x) => x.code === code);
    if (!f) throw new Error(`No floor ${code}`);
    const [a, b] = [sheet.calibration.a, sheet.calibration.b].map(([x, y]) => ({ x, y }));
    const metresPerUnit = twoPointMetresPerUnit(a!, b!, sheet.calibration.metres);
    mpp.set(code, metresPerUnit);
    f.plan = {
      kind: 'pdf',
      fileId: `${args.id}-${code}`,
      fileName: sheet.fileName,
      uploadedAt: SAMPLE_RUN_AT,
      uploadedBy: 'u-lead',
      page: { widthPt: sheet.widthPt, heightPt: sheet.heightPt },
      calibration: {
        method: 'two-point',
        pointA: a!,
        pointB: b!,
        realDistanceM: sheet.calibration.metres,
        metresPerUnit,
        calibratedAt: SAMPLE_RUN_AT,
        calibratedBy: 'u-lead',
      },
    };
  }
  const floorOf = (code: string) => p.building.floors.find((f) => f.code === code)!;
  // On a plan: PDF points through its calibration. A floor without a plan (e.g. GF here):
  // positions are metres already (the package then has no PDF point for them).
  const metres = (code: string, [x, y]: Pt): ModelPoint => {
    const k = mpp.get(code) ?? 1;
    return { x: x * k, y: y * k };
  };
  const byTag = (tag: string) => {
    const e = p.model.elements.find((x) => x.tag === tag);
    if (!e) throw new Error(`No component ${tag}`);
    return e;
  };
  const codeOf = (e: Element) => p.building.floors.find((f) => f.id === e.floorId)!.code;

  return {
    project: p,
    place(key, floor, tag, at, patch = {}) {
      const item = libraryItem(key);
      if (!item || !isPlaceable(item)) throw new Error(`Not a library item: ${key}`);
      const placed = placeElement(item, {
        id: tag.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        floorId: floorOf(floor).id,
        floorCode: floor,
        position: metres(floor, at),
        taken: p.model.elements.map((e) => e.tag),
      });
      const e = ElementSchema.parse({ ...placed, tag, ...patch });
      p.model.elements.push(e);
      return e;
    },
    feed(fromTag, toTag, corners, construction, port = 'in') {
      const from = byTag(fromTag);
      const to = byTag(toTag);
      const code = codeOf(from);
      // As drawn on the plan: from the source, through the corners, closed on the target.
      const route = closeRoute(
        [from.position, ...corners.map((c) => metres(code, c))],
        to.position,
      );
      const cable = drawCable({
        id: `c-${from.id}-${to.id}`,
        cables: p.model.cables,
        from: { element: from, port: 'out' },
        to: { element: to, port },
        route,
        floorCode: code,
        construction,
      });
      p.model.cables.push(cable);
      return cable;
    },
    between(fromTag, toTag, lengthM, construction) {
      const from = byTag(fromTag);
      const cable = drawBuildingFeeder({
        id: `c-${from.id}-${byTag(toTag).id}`,
        cables: p.model.cables,
        from,
        to: byTag(toTag),
        lengthM,
        floorCode: codeOf(from),
        construction,
      });
      p.model.cables.push(cable);
      return cable;
    },
    riser(fromTag, lengthM, feeds) {
      p.model.risers.push({
        id: `riser-${p.model.risers.length + 1}`,
        lengthM,
        widthM: 1,
        fedFromId: byTag(fromTag).id,
        feeds: feeds.map((t) => byTag(t).id),
      });
    },
    finish() {
      const outcome = cableSize(p);
      const results = mergeRun(p, { kind: 'project' }, elementResults(p, outcome), {
        runId: `revit-sample-${args.id}`,
        at: SAMPLE_RUN_AT,
        engineVersion: ENGINE_VERSION,
        inputsKey: inputsKey(p),
      });
      const sized = { ...p, model: { ...p.model, results } };
      const pfs = loadPowerFactors(sized, pack);
      const target = pack.calculationDefaults.find((d) => d.key === 'targetPowerFactor')?.value;
      const exchange = revitExchange(sized, {
        summaries: loadSummaries(sized, pfs),
        length: lengthRule(sized)!,
        powerFactors: pfs,
        targetPf: typeof target === 'number' ? target : null,
        generatedAt: SAMPLE_RUN_AT,
        engineVersion: ENGINE_VERSION,
        alignment: Object.fromEntries(
          Object.entries(args.plans).map(([code, s]) => [floorOf(code).id, s.alignment ?? []]),
        ),
        pageRotationDeg: Object.fromEntries(
          Object.entries(args.plans).map(([code, s]) => [floorOf(code).id, s.rotationDeg ?? 0]),
        ),
      });
      return { project: sized, exchange };
    },
  };
}
