import {
  applyRegistryChange,
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
  | {
      type: 'defaultOverride';
      key: string;
      value: number | string | undefined;
      ruleValue: number | string | null;
      audit: AuditMeta;
    }
  | { type: 'counts'; counts: Partial<Project['building']['counts']> }
  | { type: 'applyRegistry'; counts: FloorCounts; change: RegistryChange }
  | { type: 'gfLevel'; value: number }
  | { type: 'floor'; floorId: string; patch: { name?: string; heightM?: number | null } }
  | { type: 'fillHeights'; value: number }
  | { type: 'mechanicalFloor'; index: 0 | 1 | 2; floorId: string | null }
  | { type: 'disciplines'; discipline: Discipline; userIds: string[] }
  | {
      type: 'planUploaded';
      floorId: string;
      plan: Omit<PdfPlan, 'calibration' | 'replaced'>;
      now: string;
    }
  | { type: 'calibration'; floorId: string; calibration: Calibration | null }
  | { type: 'replaceContent'; source: Project }
  | { type: 'saved'; version: number; updatedAt: string }
  | { type: 'lastPage'; page: PageKey }
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
    case 'gfLevel':
      return { ...p, building: { ...p.building, gfLevelM: a.value } };
    case 'floor':
      return mapFloors(p, a.floorId, (f) => ({ ...f, ...a.patch }));
    case 'fillHeights':
      return {
        ...p,
        building: {
          ...p.building,
          floors: p.building.floors.map((f) => ({ ...f, heightM: a.value })),
        },
      };
    case 'mechanicalFloor': {
      const ids = [...p.building.mechanicalFloorIds] as Project['building']['mechanicalFloorIds'];
      ids[a.index] = a.floorId;
      return { ...p, building: { ...p.building, mechanicalFloorIds: ids } };
    }
    case 'disciplines':
      return { ...p, disciplines: { ...p.disciplines, [a.discipline]: a.userIds } };
    case 'planUploaded':
      return mapFloors(p, a.floorId, (f) => ({
        ...f,
        plan: withUploadedPlan(f.plan, a.plan, a.now),
      }));
    case 'calibration':
      return mapFloors(p, a.floorId, (f) =>
        f.plan ? { ...f, plan: { ...f.plan, calibration: a.calibration } } : f,
      );
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
