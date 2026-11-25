import type { Project } from '../project/schema.js';
import type { Cable } from './cable.js';
import type { ModelPoint } from './elements.js';
import { itemOfElement } from './library.js';
import type { LoadPowerFactors, LoadSummary } from './loads.js';
import { pfcRating } from './pfc.js';
import { CHECK_LABELS, type CheckCode } from './results.js';
import { inputsKey, resultOf, type StoredResult } from './sizing.js';
import { KIND_LABELS } from './topology.js';
import { cableLength, type LengthRule } from './wiring.js';

/**
 * NeuroMEP -> Revit exchange (#TASK-33, design doc Section 16 stage 2 "Import from NeuroMEP";
 * user request 12 Nov 2026). One JSON package per project: floors with their plan PDF and
 * calibration, every placed component with its position on the plan, every feeder with its route,
 * risers, and the last Cable Size results. A Revit add-in reads it to place the company's families
 * and fill their parameters. DRAFT: families, shared parameters and Revit versions are open
 * (OI-35); the format may change once the Revit team confirms it.
 *
 * Coordinates. `pdf` = PDF user space of page 1 in points (1/72 in), origin at the bottom-left
 * corner of the page, x to the right, y up. `model` = metres on the floor = pdf x metresPerPoint
 * (same origin, x right, y up): what NeuroMEP stores. A Revit plan view is also x right / y up,
 * so Revit = rotate(model) + offset, worked out per floor from two reference points whose Revit
 * coordinates are known (`floors[].alignment`); with none given, the add-in places the plan origin
 * at the Revit origin.
 */

export const REVIT_EXCHANGE_FORMAT = 'neuromep-revit-exchange';
export const REVIT_EXCHANGE_VERSION = '0.1.0';

const r = (n: number | null | undefined, d = 3) =>
  n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d;
const pt = (p: ModelPoint) => ({ x: r(p.x)!, y: r(p.y)! });

/** A reference point for lining a floor's plan up with the Revit model (e.g. a grid crossing). */
export interface RevitReferencePoint {
  name: string;
  pdf: { x: number; y: number };
  /** Revit internal coordinates of the same point, metres; null until the Revit team gives them. */
  revit: { x: number; y: number } | null;
}

export interface RevitExchangeOptions {
  summaries: ReadonlyMap<string, LoadSummary>;
  length: LengthRule;
  powerFactors: LoadPowerFactors | null;
  targetPf: number | null;
  generatedAt: string;
  engineVersion?: string;
  /** Reference points per floor id, when known. */
  alignment?: Record<string, RevitReferencePoint[]>;
  /** /Rotate of each floor's PDF page (degrees clockwise), when known (not stored by the app). */
  pageRotationDeg?: Record<string, number>;
  /**
   * Only these floors (Output > Revit Exchange, user request 25 Nov 2026): their components and
   * plan feeders, the feeders between floors with an end on them, and the risers serving them.
   * Absent = the whole project.
   */
  floorIds?: readonly string[];
}

/** Drawing / identity fields of an element: everything else is an engineering property. */
const NOT_PROPERTIES = new Set([
  'id',
  'version',
  'tag',
  'kind',
  'description',
  'floorId',
  'position',
  'symbolScale',
  'rotationDeg',
  'location',
  'discipline',
  'libraryKey',
]);

/** The parts of a stored Cable Size result a modeller needs, with its freshness. */
function resultOut(found: { result: StoredResult; outOfDate: boolean } | null) {
  if (!found) return null;
  const { result: x, outOfDate } = found;
  const checks = Object.fromEntries(
    (Object.entries(x.checks) as [CheckCode, { state: string; detail?: string }][]).map(
      ([code, c]) => [code, { name: CHECK_LABELS[code], state: c.state, detail: c.detail ?? null }],
    ),
  );
  return {
    status: outOfDate ? 'out-of-date' : x.status,
    outOfDate,
    runId: x.runId,
    ranAt: x.ranAt,
    provisionalReasons: x.provisionalReasons,
    errors: x.errors,
    sizedBy: x.sizedBy,
    device: x.device
      ? {
          type: x.device.type,
          ratingA: x.device.ratingA,
          poles: x.device.poles,
          breakingCapacityKa: x.device.faultRatingKa,
        }
      : null,
    cable: x.size
      ? {
          runs: x.size.runs,
          cores: x.size.cores,
          sizeMm2: x.size.sizeMm2,
          eccMm2: x.size.eccMm2,
          lengthM: r(x.size.lengthM, 2),
        }
      : null,
    designCurrentA: r(x.values.ibA, 2),
    ratedCurrentA: x.values.inA,
    capacityA: r(x.values.izA, 2),
    voltageDropPct: { feeder: r(x.values.vdOwnPct, 2), total: r(x.values.vdTotalPct, 2) },
    faultLevelKa: {
      max: r(x.values.ikMaxKa, 2),
      min: r(x.values.ikMinKa, 2),
      peak: r(x.values.ipKa, 2),
    },
    checks,
  };
}

/** "2 x 4C 95 mm² Cu/XLPE/SWA/PVC + 1C 50 mm² ECC" from a feeder and its result. */
function cableText(c: Cable, x: StoredResult | undefined): string | null {
  if (c.feederType === 'busbar') {
    return x?.values.izA ? `Busbar ${c.busbar?.conductor ?? 'Cu'} ${x.values.izA} A TPN+E` : null;
  }
  if (!x?.size) return null;
  const k = c.construction;
  const type = [k.conductor, k.insulation, k.armour === 'none' ? null : k.armour, k.sheath]
    .filter(Boolean)
    .join('/');
  const ecc = x.size.eccMm2 ? ` + 1C ${x.size.eccMm2} mm² ECC` : '';
  return `${x.size.runs} x ${x.size.cores} ${x.size.sizeMm2} mm² ${type}${ecc}`;
}

const loadOut = (s: LoadSummary | undefined) =>
  s
    ? {
        connectedKw: {
          L1: r(s.connected.L1, 2),
          L2: r(s.connected.L2, 2),
          L3: r(s.connected.L3, 2),
        },
        totalConnectedKw: r(s.connectedKw, 2),
        maxDemandKw: r(s.maxDemandKw, 2),
        standbyKw: r(s.standbyKw, 2),
        powerFactor: r(s.pf, 3),
        currentA: r(s.currentA, 2),
      }
    : null;

/** The exchange package of a project (from its model and stored results; nothing recalculated). */
export function revitExchange(p: Project, o: RevitExchangeOptions) {
  const { risers } = p.model;
  const only = o.floorIds ? new Set(o.floorIds) : null;
  const inScope = (floorId: string | null | undefined) =>
    !only || (floorId !== null && floorId !== undefined && only.has(floorId));
  const floorOfElement = new Map(p.model.elements.map((e) => [e.id, e.floorId]));
  const elements = p.model.elements.filter((e) => inScope(e.floorId));
  const cables = p.model.cables.filter((c) =>
    c.manualLengthM !== undefined
      ? inScope(floorOfElement.get(c.from.elementId)) || inScope(floorOfElement.get(c.to.elementId))
      : inScope(c.floorId),
  );
  const key = inputsKey(p);
  // Tags and floors of every component (a feeder's other end may be on a floor not exported).
  const byId = new Map(p.model.elements.map((e) => [e.id, e]));
  const tagOf = (id: string | null | undefined) => (id ? (byId.get(id)?.tag ?? null) : null);
  const floorOf = new Map(p.building.floors.map((f) => [f.id, f]));
  const mpp = (floorId: string) => {
    const plan = floorOf.get(floorId)?.plan;
    return plan?.kind === 'pdf' ? (plan.calibration?.metresPerUnit ?? null) : null;
  };
  const toPdf = (floorId: string, m: ModelPoint) => {
    const k = mpp(floorId);
    return k ? { x: r(m.x / k, 2)!, y: r(m.y / k, 2)! } : null;
  };

  const floors = p.building.floors
    .flatMap((f, order) => (inScope(f.id) ? [{ f, order }] : []))
    .map(({ f, order }) => {
      const plan = f.plan?.kind === 'pdf' ? f.plan : null;
      const cal = plan?.calibration ?? null;
      return {
        id: f.id,
        code: f.code,
        name: f.name,
        order,
        plan: plan
          ? {
              fileName: plan.fileName,
              pageWidthPt: plan.page.widthPt,
              pageHeightPt: plan.page.heightPt,
              /** The sheet is shown turned by this angle; coordinates stay unrotated (PDF space). */
              pageRotationDeg: o.pageRotationDeg?.[f.id] ?? null,
              calibration: cal
                ? {
                    method: cal.method,
                    metresPerPoint: cal.metresPerUnit,
                    ...(cal.method === 'two-point'
                      ? { pointA: cal.pointA, pointB: cal.pointB, realDistanceM: cal.realDistanceM }
                      : { scaleDenominator: cal.scaleDenominator, sheetSize: cal.sheetSize }),
                  }
                : null,
            }
          : null,
        alignment: { referencePoints: o.alignment?.[f.id] ?? [] },
      };
    });

  const components = elements.map((e) => {
    const item = itemOfElement(e);
    const properties = Object.fromEntries(
      Object.entries(e).filter(([k]) => !NOT_PROPERTIES.has(k)),
    );
    const pfc = e.kind === 'pfc-bank' ? pfcRating(p, e.id, o.powerFactors, o.targetPf) : null;
    return {
      neuromepId: e.id,
      tag: e.tag,
      kind: e.kind,
      kindLabel: KIND_LABELS[e.kind],
      libraryItem: item?.key ?? null,
      cmpCode: item?.cmpCode ?? null,
      discipline: e.discipline,
      floorId: e.floorId,
      description: e.description,
      room: e.location,
      placement: {
        model: pt(e.position),
        pdf: toPdf(e.floorId, e.position),
        rotationDeg: e.rotationDeg ?? 0,
        symbolScale: e.symbolScale ?? 1,
      },
      fedFrom: [
        ...cables
          .filter((c) => c.to.elementId === e.id)
          .map((c) => ({
            via: c.tag,
            from: tagOf(c.from.elementId),
            input: c.to.port,
          })),
        ...risers.flatMap((x, i) =>
          x.feeds.includes(e.id)
            ? [{ via: `Riser ${i + 1}`, from: tagOf(x.fedFromId), input: 'in' }]
            : [],
        ),
      ],
      linkedTo:
        e.kind === 'equipment'
          ? tagOf(e.fedFromId)
          : e.kind === 'meter'
            ? tagOf(e.meteredId)
            : null,
      properties,
      load: e.kind === 'meter' ? null : loadOut(o.summaries.get(e.id)),
      pfc: pfc
        ? {
            kvar: r(pfc.kvar, 2),
            targetPowerFactor: pfc.targetPf,
            panel: tagOf(pfc.panelId),
            byCategory: pfc.rows.map((x) => ({
              category: x.category,
              demandKw: r(x.demandKw, 2),
              kvar: r(x.kvar, 2),
            })),
          }
        : null,
      /** The incoming feeder's result (breaker, fault level at the component). */
      result: resultOut(resultOf(p, e.id, key)),
      revit: { uniqueId: null as string | null },
    };
  });

  const feeders = cables.map((c) => {
    const from = byId.get(c.from.elementId);
    const to = byId.get(c.to.elementId);
    const between = c.manualLengthM !== undefined;
    const found = resultOf(p, c.id, key);
    const len = cableLength(c, o.length);
    return {
      neuromepId: c.id,
      tag: c.tag,
      circuitRef: c.circuitRef,
      feederType: c.feederType,
      from: {
        neuromepId: c.from.elementId,
        tag: from?.tag ?? null,
        floorId: from?.floorId ?? null,
      },
      to: {
        neuromepId: c.to.elementId,
        tag: to?.tag ?? null,
        floorId: to?.floorId ?? null,
        input: c.to.port,
      },
      betweenFloors: between,
      /** Drawn on the plan of `floorId`; feeders between floors have no plan route. */
      floorId: between ? null : c.floorId,
      route: between
        ? null
        : { model: c.route.map(pt), pdf: c.route.map((m) => toPdf(c.floorId, m)) },
      length: {
        routedM: r(len.routedM, 2),
        additionM: r(len.additionM, 2),
        allowanceM: r(len.allowanceM, 2),
        totalM: r(len.totalM, 2),
        typed: between,
      },
      construction: c.feederType === 'cable' ? c.construction : null,
      busbar: c.feederType === 'busbar' ? (c.busbar ?? null) : null,
      description: cableText(c, found?.result),
      result: resultOut(found),
      revit: { uniqueId: null as string | null },
    };
  });

  const riserOut = risers
    .filter((x) => x.lengthM || x.fedFromId || x.feeds.length)
    .filter(
      (x) =>
        !only ||
        inScope(floorOfElement.get(x.fedFromId ?? '')) ||
        x.feeds.some((id) => inScope(floorOfElement.get(id))),
    )
    .map((x) => ({
      neuromepId: x.id,
      name: `Riser ${risers.indexOf(x) + 1}`,
      lengthM: x.lengthM,
      widthM: x.widthM,
      source: tagOf(x.fedFromId),
      tapOffs: x.feeds.map((id) => ({
        to: tagOf(id),
        floorId: byId.get(id)?.floorId ?? null,
        result: resultOut(resultOf(p, id, key)),
      })),
      result: resultOut(resultOf(p, x.id, key)),
    }));

  const all = [...components.map((c) => c.result), ...feeders.map((f) => f.result)];
  const count = (s: string) => all.filter((x) => x?.status === s).length;
  return {
    format: REVIT_EXCHANGE_FORMAT,
    version: REVIT_EXCHANGE_VERSION,
    draft:
      'Families, shared parameters and Revit versions to be confirmed by the Revit team (OI-35).',
    generatedAt: o.generatedAt,
    source: {
      application: 'NeuroMEP',
      engineVersion: o.engineVersion ?? null,
      rulePackId: p.rulePackId,
      rulePackVersion: p.rulePackVersion,
      projectVersion: p.version,
    },
    units: {
      length: 'm',
      pdf: 'pt (1/72 in)',
      power: 'kW',
      reactivePower: 'kVAr',
      current: 'A',
      faultLevel: 'kA',
      conductor: 'mm²',
      voltageDrop: '%',
      rotation: 'degrees clockwise as seen on the plan',
    },
    coordinates: {
      pdf: 'Page 1 of the floor plan PDF, origin bottom-left, x right, y up, points.',
      model: 'Metres on the floor = pdf x metresPerPoint (same origin and axes).',
      toRevit:
        'Per floor: rotation + offset from floors[].alignment.referencePoints (pdf and Revit coordinates of the same points); none given = plan origin at the Revit origin, no rotation. Level = the Revit level of the floor.',
    },
    project: {
      id: p.id,
      name: p.details.name,
      client: p.details.clientName,
      location: p.details.location,
      plotRef: p.details.plotRef,
      designStage: p.details.designStage,
      revision: p.details.revision,
    },
    floors,
    components,
    feeders,
    risers: riserOut,
    summary: {
      components: components.length,
      feeders: feeders.length,
      risers: riserOut.length,
      results: {
        final: count('final'),
        provisional: count('provisional'),
        awaitingLoad: count('awaiting-load'),
        blocked: count('blocked'),
        outOfDate: count('out-of-date'),
        notRun: all.filter((x) => x === null).length,
      },
    },
  };
}

export type RevitExchange = ReturnType<typeof revitExchange>;
