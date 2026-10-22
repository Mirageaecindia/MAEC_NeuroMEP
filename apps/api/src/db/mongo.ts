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
  mkdirSync(dbPath, { recursive: true });
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ dbPath, port: 27027 }],
  });
  const database = await connectMongo(replSet.getUri(), dbName);
  return {
    ...database,
    close: async () => {
      await database.close();
      await replSet.stop({ doCleanup: false });
    },
  };
}
