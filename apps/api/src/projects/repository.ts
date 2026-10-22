import {
  ProjectSchema,
  summarizeProject,
  type AuditEntry,
  type Floor,
  type Project,
  type ProjectSummary,
} from '@neuromep/shared';
import type { Collection, Db, MongoClient } from 'mongodb';

/** `projects` collection: the project without its floors (they live in `floors`). */
type ProjectDoc = Omit<Project, 'id' | 'building'> & {
  _id: string;
  building: Omit<Project['building'], 'floors'> & { floorIds: string[] };
};
type FloorDoc = Floor & { _id: string; projectId: string };
type AuditDoc = AuditEntry & { _id: string; projectId: string };

export type SaveResult =
  | { ok: true; project: Project }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'conflict'; currentVersion: number };

const floorKey = (projectId: string, floorId: string) => `${projectId}/${floorId}`;

/**
 * Projects across the `projects`, `floors` and `auditLog` collections. Saves use optimistic
 * locking: a save names the version it started from and fails with a conflict if someone else
 * saved in between. The project and its floors are written in one transaction.
 */
export class ProjectRepository {
  private readonly projects: Collection<ProjectDoc>;
  private readonly floors: Collection<FloorDoc>;
  private readonly audit: Collection<AuditDoc>;

  constructor(
    private readonly client: MongoClient,
    db: Db,
  ) {
    this.projects = db.collection('projects');
    this.floors = db.collection('floors');
    this.audit = db.collection('auditLog');
  }

  async init(): Promise<void> {
    await this.floors.createIndex({ projectId: 1 });
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

  /** Stores a new project as version 1. */
  async create(project: Project): Promise<Project> {
    const toStore = ProjectSchema.parse({ ...project, version: 1 });
    await this.client.withSession((session) =>
      session.withTransaction(async () => {
        await this.projects.insertOne(this.toDoc(toStore), { session });
        await this.writeFloorsAndAudit(toStore, session);
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
        await this.writeFloorsAndAudit(next, session);
        result = { ok: true, project: next };
      }),
    );
    return result;
  }

  private async writeFloorsAndAudit(
    project: Project,
    session: import('mongodb').ClientSession,
  ): Promise<void> {
    const keys = project.building.floors.map((f) => floorKey(project.id, f.id));
    await this.floors.deleteMany({ projectId: project.id, _id: { $nin: keys } }, { session });
    if (project.building.floors.length) {
      await this.floors.bulkWrite(
        project.building.floors.map((f) => ({
          replaceOne: {
            filter: { _id: floorKey(project.id, f.id) },
            replacement: { ...f, _id: floorKey(project.id, f.id), projectId: project.id },
            upsert: true,
          },
        })),
        { session },
      );
    }
    if (project.auditLog.length) {
      // The audit log is append-only: existing entries are never rewritten.
      await this.audit.bulkWrite(
        project.auditLog.map((e) => ({
          updateOne: {
            filter: { _id: `${project.id}/${e.id}` },
            update: { $setOnInsert: { ...e, projectId: project.id } },
            upsert: true,
          },
        })),
        { session },
      );
    }
  }

  private toDoc(p: Project): ProjectDoc {
    const { id, building, ...rest } = p;
    const { floors, ...b } = building;
    return { ...rest, _id: id, building: { ...b, floorIds: floors.map((f) => f.id) } };
  }

  private async assemble(doc: ProjectDoc): Promise<Project> {
    const floorDocs = await this.floors.find({ projectId: doc._id }).toArray();
    const byId = new Map(floorDocs.map(({ _id: _key, projectId: _p, ...f }) => [f.id, f as Floor]));
    const { _id, building, ...rest } = doc;
    const { floorIds, ...b } = building;
    return ProjectSchema.parse({
      ...rest,
      id: _id,
      building: { ...b, floors: floorIds.map((id) => byId.get(id)).filter(Boolean) },
    });
  }
}
