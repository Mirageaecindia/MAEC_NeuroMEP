import {
  migrateProjectData,
  ProjectSchema,
  summarizeProject,
  type AuditEntry,
  type Cable,
  type Element,
  type Floor,
  type Project,
  type ProjectSummary,
} from '@neuromep/shared';
import type { ClientSession, Collection, Db, MongoClient } from 'mongodb';

/**
 * `projects` collection: the project without floors, elements and cables (stored separately).
 * The short model lists (risers, floor flags) stay in the project document.
 */
type ProjectDoc = Omit<Project, 'id' | 'building' | 'model'> & {
  _id: string;
  building: Omit<Project['building'], 'floors'> & { floorIds: string[] };
  model?: Omit<Project['model'], 'elements' | 'cables'>;
};
type FloorDoc = Floor & { _id: string; projectId: string };
/** `elements` collection: network elements and cables of a project, in model order. */
type ElementDoc =
  | { _id: string; projectId: string; order: number; docType: 'element'; data: Element }
  | { _id: string; projectId: string; order: number; docType: 'cable'; data: Cable };
type AuditDoc = AuditEntry & { _id: string; projectId: string };

export type SaveResult =
  | { ok: true; project: Project }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'conflict'; currentVersion: number };

const key = (projectId: string, id: string) => `${projectId}/${id}`;

/** Exported file types; each is numbered on its own. */
export const EXPORT_KINDS = [
  'sld',
  'schedules',
  'schedules-pdf',
  'calc-sheet',
  'calc-sheet-pdf',
  'generator-analysis',
  'generator-analysis-pdf',
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** `exports` collection: the last version number of each export of a project. */
interface ExportDoc {
  _id: string;
  projectId: string;
  kind: ExportKind;
  version: number;
  lastBy: string;
  lastAt: string;
}

/**
 * Projects across the `projects`, `floors`, `elements` and `auditLog` collections. Saves use
 * optimistic locking: a save names the version it started from and fails with a conflict if
 * someone else saved in between. Everything is written in one transaction.
 */
export class ProjectRepository {
  private readonly projects: Collection<ProjectDoc>;
  private readonly floors: Collection<FloorDoc>;
  private readonly elements: Collection<ElementDoc>;
  private readonly audit: Collection<AuditDoc>;
  private readonly exports: Collection<ExportDoc>;

  constructor(
    private readonly client: MongoClient,
    db: Db,
  ) {
    this.projects = db.collection('projects');
    this.floors = db.collection('floors');
    this.elements = db.collection('elements');
    this.audit = db.collection('auditLog');
    this.exports = db.collection('exports');
  }

  /**
   * Next version number of an export of a project (_v1, _v2 ...): export files never overwrite
   * (Section 7). Records who exported last and when.
   */
  async nextExportVersion(projectId: string, kind: ExportKind, by: string, at: string) {
    const doc = await this.exports.findOneAndUpdate(
      { _id: `${projectId}:${kind}` },
      { $inc: { version: 1 }, $set: { projectId, kind, lastBy: by, lastAt: at } },
      { upsert: true, returnDocument: 'after' },
    );
    return doc!.version;
  }

  async init(): Promise<void> {
    await this.floors.createIndex({ projectId: 1 });
    await this.elements.createIndex({ projectId: 1, order: 1 });
    await this.audit.createIndex({ projectId: 1, at: 1 });
  }

  async list(): Promise<Project[]> {
    const docs = await this.projects.find().sort({ 'meta.updatedAt': -1 }).toArray();
    return Promise.all(docs.map((d) => this.assemble(d)));
  }

  async listSummaries(filter: (p: Project) => boolean): Promise<ProjectSummary[]> {
    return (await this.list()).filter(filter).map(summarizeProject);
  }

  async get(id: string): Promise<Project | null> {
    const doc = await this.projects.findOne({ _id: id });
    return doc ? this.assemble(doc) : null;
  }

  /**
   * Deletes a project with its floors, components and feeders (user request 7 Nov 2026). The
   * audit log is append-only and stays; export numbers stay so a file name never repeats.
   */
  async remove(id: string): Promise<boolean> {
    let found = false;
    await this.client.withSession((session) =>
      session.withTransaction(async () => {
        found = (await this.projects.deleteOne({ _id: id }, { session })).deletedCount === 1;
        await this.floors.deleteMany({ projectId: id }, { session });
        await this.elements.deleteMany({ projectId: id }, { session });
      }),
    );
    return found;
  }

  /** Stores a new project as version 1. */
  async create(project: Project): Promise<Project> {
    const toStore = ProjectSchema.parse({ ...project, version: 1 });
    await this.client.withSession((session) =>
      session.withTransaction(async () => {
        await this.projects.insertOne(this.toDoc(toStore), { session });
        await this.writeChildren(toStore, session);
      }),
    );
    return toStore;
  }

  /** Saves `project`, which must carry the version it was loaded at. */
  async save(project: Project, now: string): Promise<SaveResult> {
    const parsed = ProjectSchema.parse(project);
    const expected = parsed.version;
    const next: Project = {
      ...parsed,
      version: expected + 1,
      meta: { ...parsed.meta, updatedAt: now },
    };
    let result: SaveResult = { ok: false, reason: 'not-found' };
    await this.client.withSession((session) =>
      session.withTransaction(async () => {
        const { _id, ...doc } = this.toDoc(next);
        const updated = await this.projects.findOneAndUpdate(
          { _id, version: expected },
          { $set: doc },
          { session, returnDocument: 'after' },
        );
        if (!updated) {
          const current = await this.projects.findOne(
            { _id },
            { session, projection: { version: 1 } },
          );
          result = current
            ? { ok: false, reason: 'conflict', currentVersion: current.version }
            : { ok: false, reason: 'not-found' };
          await session.abortTransaction();
          return;
        }
        await this.writeChildren(next, session);
        result = { ok: true, project: next };
      }),
    );
    return result;
  }

  private async writeChildren(project: Project, session: ClientSession): Promise<void> {
    const pid = project.id;
    const floorKeys = project.building.floors.map((f) => key(pid, f.id));
    await this.floors.deleteMany({ projectId: pid, _id: { $nin: floorKeys } }, { session });
    if (floorKeys.length) {
      await this.floors.bulkWrite(
        project.building.floors.map((f) => ({
          replaceOne: {
            filter: { _id: key(pid, f.id) },
            replacement: { ...f, _id: key(pid, f.id), projectId: pid },
            upsert: true,
          },
        })),
        { session },
      );
    }

    const docs: ElementDoc[] = [
      ...project.model.elements.map((data, order): ElementDoc => ({
        _id: key(pid, data.id),
        projectId: pid,
        order,
        docType: 'element',
        data,
      })),
      ...project.model.cables.map((data, order): ElementDoc => ({
        _id: key(pid, data.id),
        projectId: pid,
        order,
        docType: 'cable',
        data,
      })),
    ];
    await this.elements.deleteMany(
      { projectId: pid, _id: { $nin: docs.map((d) => d._id) } },
      { session },
    );
    if (docs.length) {
      await this.elements.bulkWrite(
        docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
        { session },
      );
    }

    if (project.auditLog.length) {
      // The audit log is append-only: existing entries are never rewritten.
      await this.audit.bulkWrite(
        project.auditLog.map((e) => ({
          updateOne: {
            filter: { _id: key(pid, e.id) },
            update: { $setOnInsert: { ...e, projectId: pid } },
            upsert: true,
          },
        })),
        { session },
      );
    }
  }

  private toDoc(p: Project): ProjectDoc {
    const { id, building, model, ...rest } = p;
    const { floors, ...b } = building;
    const { elements: _e, cables: _c, ...lists } = model;
    return {
      ...rest,
      _id: id,
      building: { ...b, floorIds: floors.map((f) => f.id) },
      model: lists,
    };
  }

  private async assemble(doc: ProjectDoc): Promise<Project> {
    const [floorDocs, elementDocs] = await Promise.all([
      this.floors.find({ projectId: doc._id }).toArray(),
      this.elements.find({ projectId: doc._id }).sort({ order: 1 }).toArray(),
    ]);
    const byId = new Map(floorDocs.map(({ _id: _key, projectId: _p, ...f }) => [f.id, f as Floor]));
    const { _id, building, model, ...rest } = doc;
    const { floorIds, ...b } = building;
    // Stored documents from older schema versions are upgraded on read.
    return ProjectSchema.parse(
      migrateProjectData({
        ...rest,
        id: _id,
        building: { ...b, floors: floorIds.map((id) => byId.get(id)).filter(Boolean) },
        model: {
          ...model, // absent in projects stored before WBS 1.4.1: the schema defaults apply
          elements: elementDocs.filter((d) => d.docType === 'element').map((d) => d.data),
          cables: elementDocs.filter((d) => d.docType === 'cable').map((d) => d.data),
        },
      }),
    );
  }
}
