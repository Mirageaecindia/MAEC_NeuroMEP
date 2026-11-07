import {
  applyRegistryChange,
  type LoadLine,
  ElementSchema,
  moveCableEnd,
  type Cable,
  type BusbarSpec,
  type CableConstruction,
  type FeederType,
  type ElementResult,
  mergeRun,
  type SizingScope,
  type Element,
  type ModelPoint,
  laterPage,
  reachedPage,
  type Calibration,
  type CalculationCheck,
  type DemandCategory,
  type FloorCounts,
  type LoadTypeCode,
  type PageKey,
  type PdfPlan,
  type Project,
  type Region,
  withoutElements,
  setFloorFlag,
  type Riser,
  setGeneratorFactor,
  withSafetyDefaults,
  changeKind,
  portsAfterKindChange,
  type ElementKind,
  type GeneratorFactor,
  type RegistryChange,
} from '@neuromep/shared';
import { applyRulePackDefaults, rulePackForRegion } from '@neuromep/rulepacks';

/** Who and when, for audit-logged changes (supplied by the caller so the reducer stays pure). */
export interface AuditMeta {
  id: string;
  at: string;
  userId: string;
}

type SiteKey = 'ambientAirC' | 'ambientSoilC' | 'soilResistivity';
type Discipline = keyof Project['disciplines'];

export type ProjectAction =
  | { type: 'details'; patch: Partial<Project['details']> }
  | { type: 'site'; key: SiteKey; value: number | null }
  | { type: 'altitude'; value: number | null }
  | { type: 'region'; region: Region }
  | { type: 'upstreamMva'; value: number | null }
  | { type: 'check'; check: CalculationCheck; enabled: boolean }
  | {
      type: 'demandFactor';
      table: 'byLoadType';
      key: LoadTypeCode;
      value: number | null;
      audit: AuditMeta;
    }
  | {
      type: 'demandFactor';
      table: 'byCategory';
      key: DemandCategory;
      value: number | null;
      audit: AuditMeta;
    }
  /** Demand method (3 Nov 2026) with the factors it brings (rule-pack set, user values kept). */
  | {
      type: 'demandMethod';
      method: Project['calculation']['demandMethod'];
      factors: Project['calculation']['demandFactors'];
    }
  | { type: 'secondLevelFactor'; value: number | null; audit: AuditMeta }
  | { type: 'busbarMaker'; maker: Project['calculation']['busbarMaker'] }
  | {
      type: 'defaultOverride';
      key: string;
      value: number | string | undefined;
      ruleValue: number | string | null;
      audit: AuditMeta;
    }
  | { type: 'counts'; counts: Partial<Project['building']['counts']> }
  | { type: 'applyRegistry'; counts: FloorCounts; change: RegistryChange }
  /** Mechanical floor 1-3 (12.1): a floor above ground, or none. */
  | { type: 'mechanicalFloor'; index: number; floorId: string | null }
  /** Mechanical floor rows after + (a new empty row) or x (a row removed). */
  | { type: 'mechanicalFloors'; ids: (string | null)[] }
  /** A floor's display name (Building tab, user request 7 Nov 2026); its code never changes. */
  | { type: 'renameFloor'; floorId: string; name: string }
  | { type: 'disciplines'; discipline: Discipline; userIds: string[] }
  | {
      type: 'planUploaded';
      floorId: string;
      plan: Omit<PdfPlan, 'calibration' | 'replaced'>;
      now: string;
      /** Typical floors given the same plan (one plan for the typical set, 7 Nov 2026). */
      alsoFloorIds?: string[];
    }
  | { type: 'calibration'; floorId: string; calibration: Calibration | null }
  | { type: 'replaceContent'; source: Project }
  | { type: 'saved'; version: number; updatedAt: string }
  | { type: 'lastPage'; page: PageKey }
  /** Floor Setup components (#TASK-12); positions in metres. */
  | { type: 'placeElement'; element: Element }
  | { type: 'moveElement'; id: string; position: ModelPoint }
  /** Several components moved together by `delta` metres; feeders between them move along. */
  | { type: 'moveElements'; ids: string[]; delta: ModelPoint }
  /** Change type (manager feedback, 7 Nov 2026): the component becomes `kind`, feeders kept. */
  | { type: 'changeKind'; id: string; kind: ElementKind }
  /** Components turned by `by` degrees (clockwise), or set to `to` degrees. */
  | { type: 'rotateElements'; ids: string[]; by?: number; to?: number }
  /**
   * Pasted or replicated components with the feeders between them (copyComponents); `replaceIds`
   * are removed first (Replicate floor - Replace).
   */
  | { type: 'pasteComponents'; elements: Element[]; cables: Cable[]; replaceIds?: string[] }
  /** Properties of a component (12.3); refused unless the result is a valid element. */
  | { type: 'updateElement'; id: string; patch: Record<string, unknown> }
  | { type: 'removeElements'; ids: string[] }
  /** Cables (#TASK-13); always the electrical layer. */
  | { type: 'addCable'; cable: Cable }
  | {
      type: 'updateCable';
      id: string;
      patch: {
        tag?: string;
        construction?: CableConstruction;
        feederType?: FeederType;
        busbar?: BusbarSpec;
      };
    }
  | { type: 'removeCables'; ids: string[] }
  /** Building tab risers (FR-20): Riser Design and connections, edited with the shared helpers. */
  | { type: 'risers'; risers: Riser[] }
  /** Generator Load Analysis: the engineer's factors / remark of one load (OI-11). */
  | {
      type: 'generatorFactor';
      elementId: string;
      patch: Partial<Omit<GeneratorFactor, 'elementId'>>;
      /** The row's starting factors, kept for the cases this edit does not set. */
      start: Pick<GeneratorFactor, 'normal' | 'powerFailure' | 'fire'>;
    }
  /** Results of a Cable Size run (FR-21): those of the scope replace the earlier ones. */
  | {
      type: 'cableSize';
      scope: SizingScope;
      results: ElementResult[];
      run: Parameters<typeof mergeRun>[3];
    }
  /** Floor flagged done for a discipline (A-08), or reopened (`flag` null, the Lead only). */
  | {
      type: 'floorFlag';
      floorId: string;
      discipline: Discipline;
      flag: { by: string; at: string } | null;
    }
  /** DB loads replaced from an Excel sheet (FR-35); one audit entry per DB (total kW). */
  | {
      type: 'loadImport';
      changes: { id: string; tag: string; loads: LoadLine[]; beforeKw: number; afterKw: number }[];
      audit: AuditMeta;
    }
  | {
      /** A confirmed change to a Page 1 calculation input (Section 9). */
      type: 'earlierPageChange';
      key: string;
      from: number | string | null;
      to: number | string | null;
      audit: AuditMeta;
    };

const mapFloors = (
  p: Project,
  floorId: string,
  f: (floor: Project['building']['floors'][number]) => Project['building']['floors'][number],
): Project => ({
  ...p,
  building: { ...p.building, floors: p.building.floors.map((x) => (x.id === floorId ? f(x) : x)) },
});

/** A new plan on a floor. Replacing a plan resets calibration and keeps the old one for alignment (FR-09). */
export function withUploadedPlan(
  previous: PdfPlan | null,
  uploaded: Omit<PdfPlan, 'calibration' | 'replaced'>,
  now: string,
): PdfPlan {
  if (!previous) return { ...uploaded, calibration: null };
  return {
    ...uploaded,
    calibration: null,
    replaced: {
      fileId: previous.fileId,
      fileName: previous.fileName,
      page: previous.page,
      calibration: previous.calibration,
      replacedAt: now,
      alignment: 'pending',
    },
  };
}

export function projectReducer(p: Project, a: ProjectAction): Project {
  switch (a.type) {
    case 'details':
      return { ...p, details: { ...p.details, ...a.patch } };
    case 'site':
      return { ...p, site: { ...p.site, [a.key]: { value: a.value, source: 'user' } } };
    case 'altitude':
      return { ...p, site: { ...p.site, altitudeM: a.value } };
    case 'region': {
      const next = { ...p, calculation: { ...p.calculation, region: a.region } };
      const pack = rulePackForRegion(a.region);
      return pack ? applyRulePackDefaults(next, pack) : next;
    }
    case 'upstreamMva':
      return { ...p, calculation: { ...p.calculation, upstreamFaultMva: a.value } };
    case 'check':
      return {
        ...p,
        calculation: {
          ...p.calculation,
          checks: { ...p.calculation.checks, [a.check]: a.enabled },
        },
      };
    case 'demandMethod':
      return {
        ...p,
        calculation: { ...p.calculation, demandMethod: a.method, demandFactors: a.factors },
      };
    case 'secondLevelFactor':
      return {
        ...p,
        calculation: {
          ...p.calculation,
          demandFactors: {
            ...p.calculation.demandFactors,
            secondLevel: { value: a.value, source: 'user' },
          },
        },
      };
    case 'busbarMaker':
      return { ...p, calculation: { ...p.calculation, busbarMaker: a.maker } };
    case 'demandFactor': {
      const table = p.calculation.demandFactors[a.table] as Record<
        string,
        { value: number | null }
      >;
      const from = table[a.key]?.value ?? null;
      if (from === a.value) return p;
      return {
        ...p,
        calculation: {
          ...p.calculation,
          demandFactors: {
            ...p.calculation.demandFactors,
            [a.table]: { ...table, [a.key]: { value: a.value, source: 'user' } },
          },
        },
        auditLog: [
          ...p.auditLog,
          { ...a.audit, area: 'demandFactor', key: `${a.table}.${a.key}`, from, to: a.value },
        ],
      };
    }
    case 'placeElement':
      return { ...p, model: { ...p.model, elements: [...p.model.elements, a.element] } };
    case 'moveElement':
      // Cables attached to the component follow it (#TASK-13).
      return {
        ...p,
        model: {
          ...p.model,
          elements: p.model.elements.map((e) =>
            e.id === a.id ? { ...e, position: a.position, version: e.version + 1 } : e,
          ),
          cables: p.model.cables.map((c) => {
            let next = c;
            if (c.from.elementId === a.id) next = moveCableEnd(next, 'from', a.position);
            if (c.to.elementId === a.id) next = moveCableEnd(next, 'to', a.position);
            return next === c ? c : { ...next, version: c.version + 1 };
          }),
        },
      };
    case 'moveElements': {
      const moved = new Set(a.ids);
      const shift = (q: ModelPoint) => ({ x: q.x + a.delta.x, y: q.y + a.delta.y });
      const byId = new Map(p.model.elements.map((e) => [e.id, e]));
      return {
        ...p,
        model: {
          ...p.model,
          elements: p.model.elements.map((e) =>
            moved.has(e.id) ? { ...e, position: shift(e.position), version: e.version + 1 } : e,
          ),
          cables: p.model.cables.map((c) => {
            const from = moved.has(c.from.elementId);
            const to = moved.has(c.to.elementId);
            if (from && to) return { ...c, route: c.route.map(shift), version: c.version + 1 };
            let next = c;
            if (from)
              next = moveCableEnd(next, 'from', shift(byId.get(c.from.elementId)!.position));
            if (to) next = moveCableEnd(next, 'to', shift(byId.get(c.to.elementId)!.position));
            return next === c ? c : { ...next, version: c.version + 1 };
          }),
        },
      };
    }
    case 'changeKind': {
      const e = p.model.elements.find((x) => x.id === a.id);
      const taken = p.model.elements.filter((x) => x.id !== a.id).map((x) => x.tag);
      const next = e && changeKind(e, a.kind, taken);
      if (!next || next === e) return p;
      return {
        ...p,
        model: {
          ...p.model,
          elements: p.model.elements.map((x) => (x.id === a.id ? next : x)),
          cables: portsAfterKindChange(p.model.cables, a.id, a.kind),
        },
      };
    }
    case 'rotateElements': {
      const turned = new Set(a.ids);
      const angle = (e: Element) => {
        const deg = a.to ?? (e.rotationDeg ?? 0) + (a.by ?? 90);
        return ((Math.round(deg) % 360) + 360) % 360;
      };
      return {
        ...p,
        model: {
          ...p.model,
          elements: p.model.elements.map((e) =>
            turned.has(e.id) ? { ...e, rotationDeg: angle(e), version: e.version + 1 } : e,
          ),
        },
      };
    }
    case 'pasteComponents': {
      const gone = new Set(a.replaceIds ?? []);
      return {
        ...p,
        model: {
          ...p.model,
          elements: [...p.model.elements.filter((e) => !gone.has(e.id)), ...a.elements],
          risers: withoutElements(p.model.risers, gone),
          cables: [
            ...p.model.cables.filter(
              (c) => !gone.has(c.from.elementId) && !gone.has(c.to.elementId),
            ),
            ...a.cables,
          ],
        },
      };
    }
    case 'updateElement': {
      // Identity, kind, floor and discipline layer never change through a property edit.
      const { id: _id, kind: _k, floorId: _f, discipline: _d, ...change } = a.patch;
      return {
        ...p,
        model: {
          ...p.model,
          elements: p.model.elements.map((e) => {
            if (e.id !== a.id) return e;
            const next = ElementSchema.safeParse({
              ...e,
              ...withSafetyDefaults(e, change),
              version: e.version + 1,
            });
            return next.success ? next.data : e;
          }),
        },
      };
    }
    case 'removeElements': {
      // A removed component takes the cables connected to it along (they would have no end).
      const gone = new Set(a.ids);
      return {
        ...p,
        model: {
          ...p.model,
          elements: p.model.elements.filter((e) => !gone.has(e.id)),
          risers: withoutElements(p.model.risers, gone),
          cables: p.model.cables.filter(
            (c) => !gone.has(c.from.elementId) && !gone.has(c.to.elementId),
          ),
        },
      };
    }
    case 'addCable':
      return { ...p, model: { ...p.model, cables: [...p.model.cables, a.cable] } };
    case 'updateCable':
      return {
        ...p,
        model: {
          ...p.model,
          cables: p.model.cables.map((c) =>
            c.id === a.id ? { ...c, ...a.patch, version: c.version + 1 } : c,
          ),
        },
      };
    case 'removeCables': {
      const gone = new Set(a.ids);
      return { ...p, model: { ...p.model, cables: p.model.cables.filter((c) => !gone.has(c.id)) } };
    }
    case 'risers':
      return { ...p, model: { ...p.model, risers: a.risers } };
    case 'cableSize':
      return { ...p, model: { ...p.model, results: mergeRun(p, a.scope, a.results, a.run) } };
    case 'generatorFactor':
      return {
        ...p,
        model: {
          ...p.model,
          generatorFactors: setGeneratorFactor(
            p.model.generatorFactors,
            a.elementId,
            a.patch,
            a.start,
          ),
        },
      };
    case 'floorFlag': {
      const floorFlags = setFloorFlag(p.model.floorFlags, a.floorId, a.discipline, a.flag);
      return { ...p, model: { ...p.model, floorFlags } };
    }
    case 'loadImport': {
      const byId = new Map(a.changes.map((c) => [c.id, c]));
      return {
        ...p,
        model: {
          ...p.model,
          elements: p.model.elements.map((e) => {
            const c = byId.get(e.id);
            return c && e.kind === 'db' ? { ...e, loads: c.loads, version: e.version + 1 } : e;
          }),
        },
        auditLog: [
          ...p.auditLog,
          ...a.changes.map((c, i) => ({
            ...a.audit,
            id: `${a.audit.id}-${i}`,
            area: 'loadImport' as const,
            key: c.tag,
            from: Math.round(c.beforeKw * 1000) / 1000,
            to: Math.round(c.afterKw * 1000) / 1000,
          })),
        ],
      };
    }
    case 'earlierPageChange':
      return {
        ...p,
        auditLog: [
          ...p.auditLog,
          { ...a.audit, area: 'earlierPageChange', key: a.key, from: a.from, to: a.to },
        ],
      };
    case 'defaultOverride': {
      const overrides = { ...p.calculation.defaultOverrides };
      const from = overrides[a.key] ?? a.ruleValue;
      if (a.value === undefined) delete overrides[a.key];
      else overrides[a.key] = a.value;
      const to = a.value ?? a.ruleValue;
      if (from === to && (a.value === undefined) === !(a.key in p.calculation.defaultOverrides))
        return p;
      return {
        ...p,
        calculation: { ...p.calculation, defaultOverrides: overrides },
        auditLog: [...p.auditLog, { ...a.audit, area: 'calculationDefault', key: a.key, from, to }],
      };
    }
    case 'counts':
      return { ...p, building: { ...p.building, counts: { ...p.building.counts, ...a.counts } } };
    case 'applyRegistry':
      return { ...p, building: applyRegistryChange(p.building, a.counts, a.change) };
    case 'mechanicalFloor': {
      const ids = [...p.building.mechanicalFloorIds];
      while (ids.length <= a.index) ids.push(null);
      ids[a.index] = a.floorId;
      return { ...p, building: { ...p.building, mechanicalFloorIds: ids } };
    }
    case 'mechanicalFloors':
      return { ...p, building: { ...p.building, mechanicalFloorIds: a.ids } };
    case 'renameFloor': {
      const name = a.name.trim();
      return name ? mapFloors(p, a.floorId, (f) => ({ ...f, name })) : p;
    }
    case 'disciplines':
      return { ...p, disciplines: { ...p.disciplines, [a.discipline]: a.userIds } };
    case 'planUploaded': {
      const to = new Set([a.floorId, ...(a.alsoFloorIds ?? [])]);
      return {
        ...p,
        building: {
          ...p.building,
          floors: p.building.floors.map((f) =>
            to.has(f.id) ? { ...f, plan: withUploadedPlan(f.plan, a.plan, a.now) } : f,
          ),
        },
      };
    }
    case 'calibration': {
      // Floors sharing the plan file (the typical set) share its calibration, except a floor
      // flagged done (A-08), which stays as it is.
      const fileId = p.building.floors.find((f) => f.id === a.floorId)?.plan?.fileId;
      const locked = (id: string) =>
        p.model.floorFlags.some((flag) => flag.floorId === id) && id !== a.floorId;
      return {
        ...p,
        building: {
          ...p.building,
          floors: p.building.floors.map((f) =>
            f.plan && (f.id === a.floorId || (f.plan.fileId === fileId && !locked(f.id)))
              ? { ...f, plan: { ...f.plan, calibration: a.calibration } }
              : f,
          ),
        },
      };
    }
    case 'replaceContent':
      // Import Saved Project into the open project: content from the file, identity from here.
      return { ...a.source, id: p.id, version: p.version, meta: { ...p.meta } };
    case 'saved':
      return { ...p, version: a.version, meta: { ...p.meta, updatedAt: a.updatedAt } };
    case 'lastPage':
      return {
        ...p,
        meta: { ...p.meta, lastPage: a.page, reachedPage: laterPage(reachedPage(p.meta), a.page) },
      };
  }
}
