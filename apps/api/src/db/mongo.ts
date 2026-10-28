import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoClient, type Db } from 'mongodb';

export interface Database {
  client: MongoClient;
  db: Db;
  close(): Promise<void>;
}

/** Connects to MONGODB_URI (Atlas or a local server). */
export async function connectMongo(uri: string, dbName: string): Promise<Database> {
  const client = await MongoClient.connect(uri);
  return { client, db: client.db(dbName), close: () => client.close() };
}

/**
 * Development only: starts an in-process single-node replica set (transactions need one) with
 * its data kept in `dataDir`, so `npm run dev` works without installing MongoDB.
 */
export async function startDevMongo(dataDir: string, dbName: string): Promise<Database> {
  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const dbPath = resolve(dataDir, 'mongo');
  // Development only: dbPath comes from the DATA_DIR setting, not from a request.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  mkdirSync(dbPath, { recursive: true });
  let replSet: InstanceType<typeof MongoMemoryReplSet>;
  try {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      instanceOpts: [{ dbPath, port: 27027 }],
    });
  } catch (e) {
    // The usual cause: `npm run dev` is already running in another terminal.
    if (/DBPathInUse|EADDRINUSE|address already in use/i.test(String(e))) {
      throw new Error(
        `The development database in ${dbPath} is already in use - NeuroMEP is probably running ` +
          'in another terminal. Stop it there (Ctrl + C), then run npm run dev again.',
        { cause: e },
      );
    }
    throw e;
  }
  const database = await connectMongo(replSet.getUri(), dbName);
  return {
    ...database,
    close: async () => {
      await database.close();
      await replSet.stop({ doCleanup: false });
    },
  };
}
