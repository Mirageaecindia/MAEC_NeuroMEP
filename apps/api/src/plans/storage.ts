import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { GridFSBucket, type Db } from 'mongodb';

export interface StoredPlan {
  fileId: string;
  fileName: string;
  uploadedAt: string;
}

/**
 * Floor-plan file storage (A-02: one interface, so a tile converter or object storage can be
 * added later). MongoDB documents keep only the returned fileId.
 */
export interface PlanStorage {
  put(args: {
    projectId: string;
    fileName: string;
    data: Buffer;
    userId: string;
    now: string;
    /** Keep an existing id (moving plans between storages); a new one otherwise. */
    fileId?: string;
  }): Promise<StoredPlan>;
  /** The file as a stream, or null if it does not exist in this project. */
  open(projectId: string, fileId: string): Promise<Readable | null>;
  /** Removes every plan file of a deleted project. */
  removeProject(projectId: string): Promise<void>;
}

/** Ids become folder and file names, so only plain ids are accepted. */
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Plans on the server disk (A-02): `<root>/<projectId>/<fileId>.pdf` with a `<fileId>.json`
 * beside it (original name, uploader, time). A file is written under a temporary name and then
 * renamed, so a half-written plan is never served.
 */
export class DiskPlanStorage implements PlanStorage {
  constructor(private readonly root: string) {}

  private paths(projectId: string, fileId: string) {
    if (!SAFE_ID.test(projectId) || !SAFE_ID.test(fileId)) return null;
    const dir = join(this.root, projectId);
    return { dir, pdf: join(dir, `${fileId}.pdf`), meta: join(dir, `${fileId}.json`) };
  }

  async put({ projectId, fileName, data, userId, now, fileId }: Parameters<PlanStorage['put']>[0]) {
    const id = fileId ?? randomUUID();
    const p = this.paths(projectId, id);
    if (!p) throw new Error(`Unsafe plan id ${projectId}/${id}`);
    const meta = { fileName, uploadedBy: userId, uploadedAt: now, contentType: 'application/pdf' };
    // Paths are built from server-generated ids checked against SAFE_ID, never from file names.
    /* eslint-disable security/detect-non-literal-fs-filename */
    await mkdir(p.dir, { recursive: true });
    await writeFile(`${p.pdf}.part`, data);
    await writeFile(p.meta, JSON.stringify(meta));
    await rename(`${p.pdf}.part`, p.pdf);
    /* eslint-enable security/detect-non-literal-fs-filename */
    return { fileId: id, fileName, uploadedAt: now };
  }

  async has(projectId: string, fileId: string): Promise<boolean> {
    const p = this.paths(projectId, fileId);
    if (!p) return false;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- checked ids (SAFE_ID)
    const found = await stat(p.pdf).catch(() => null);
    return found !== null;
  }

  async removeProject(projectId: string): Promise<void> {
    if (!SAFE_ID.test(projectId)) throw new Error(`Unsafe project id ${projectId}`);

    await rm(join(this.root, projectId), { recursive: true, force: true });
  }

  async open(projectId: string, fileId: string) {
    const p = this.paths(projectId, fileId);
    if (!p || !(await this.has(projectId, fileId))) return null;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- checked ids (SAFE_ID)
    return createReadStream(p.pdf);
  }

  /** Stored details of a plan (used by tests and support). */
  async meta(projectId: string, fileId: string): Promise<Record<string, string> | null> {
    const p = this.paths(projectId, fileId);
    if (!p) return null;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- checked ids (SAFE_ID)
    return readFile(p.meta, 'utf8').then(
      (t) => JSON.parse(t) as Record<string, string>,
      () => null,
    );
  }
}

/**
 * Plans uploaded before A-02 were kept in MongoDB GridFS (bucket `plans`). Copies each one to the
 * disk storage under the same id, so floors keep pointing at their plan. Returns how many moved.
 */
export async function movePlansFromGridFs(db: Db, disk: DiskPlanStorage): Promise<number> {
  const bucket = new GridFSBucket(db, { bucketName: 'plans' });
  let moved = 0;
  for await (const file of bucket.find({})) {
    const meta = (file.metadata ?? {}) as Record<string, string>;
    const projectId = meta.projectId;
    const fileId = file._id.toString();
    if (!projectId || (await disk.has(projectId, fileId))) continue;
    const chunks: Buffer[] = [];
    for await (const chunk of bucket.openDownloadStream(file._id)) chunks.push(chunk as Buffer);
    await disk.put({
      projectId,
      fileId,
      fileName: file.filename,
      data: Buffer.concat(chunks),
      userId: meta.uploadedBy ?? 'unknown',
      now: meta.uploadedAt ?? file.uploadDate.toISOString(),
    });
    moved += 1;
  }
  return moved;
}
