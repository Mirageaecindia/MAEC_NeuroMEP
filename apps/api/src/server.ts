import { createApp } from './app.js';
import { DevAuthProvider } from './auth/dev-provider.js';
import { loadConfig } from './config.js';
import { connectMongo, startDevMongo } from './db/mongo.js';
import { GridFsPlanStorage } from './plans/storage.js';
import { ProjectRepository } from './projects/repository.js';

const config = loadConfig();

const database = config.MONGODB_URI
  ? await connectMongo(config.MONGODB_URI, config.MONGODB_DB)
  : await startDevMongo(config.DATA_DIR, config.MONGODB_DB);
if (!config.MONGODB_URI) console.log(`Development MongoDB (data in ${config.DATA_DIR}/mongo)`);

const projects = new ProjectRepository(database.client, database.db);
await projects.init();

const app = createApp({
  auth: new DevAuthProvider(config.authSecret),
  projects,
  plans: new GridFsPlanStorage(database.db),
});

const server = app.listen(config.API_PORT, () => {
  console.log(`NeuroMEP API listening on http://localhost:${config.API_PORT}`);
});

const shutdown = () => server.close(() => void database.close().then(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
