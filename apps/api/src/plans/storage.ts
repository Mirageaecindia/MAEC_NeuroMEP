import { Readable } from 'node:stream';
import { GridFSBucket, ObjectId, type Db } from 'mongodb';

export interface StoredPlan {
  fileId: string;
  fileName: string;
  uploadedAt: string;
}

/**
 * Floor-plan PDF storage. GridFS now; object storage can replace it behind this interface.
 * MongoDB documents keep only the returned fileId.
 */
export interface PlanStorage {
  put(args: {
    projectId: string;
    fileName: string;
    data: Buffer;
    userId: string;
    now: string;
  }): Promise<StoredPlan>;
  /** The file as a stream, or null if it does not exist in this project. */
  open(projectId: string, fileId: string): Promise<Readable | null>;
}

export class GridFsPlanStorage implements PlanStorage {
  private readonly bucket: GridFSBucket;

  constructor(db: Db) {
    this.bucket = new GridFSBucket(db, { bucketName: 'plans' });
  }

  async put({ projectId, fileName, data, userId, now }: Parameters<PlanStorage['put']>[0]) {
    const upload = this.bucket.openUploadStream(fileName, {
      metadata: { projectId, uploadedBy: userId, uploadedAt: now, contentType: 'application/pdf' },
    });
    await new Promise<void>((resolve, reject) => {
      Readable.from(data).pipe(upload).on('finish', resolve).on('error', reject);
    });
    return { fileId: upload.id.toString(), fileName, uploadedAt: now };
  }

  async open(projectId: string, fileId: string) {
    if (!ObjectId.isValid(fileId)) return null;
    const _id = new ObjectId(fileId);
    const file = await this.bucket.find({ _id, 'metadata.projectId': projectId }).next();
    return file ? this.bucket.openDownloadStream(_id) : null;
  }
}
