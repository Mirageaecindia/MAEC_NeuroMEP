/* global db, print -- mongosh globals in docker-entrypoint-initdb.d scripts */
// First start only (empty data volume): the account the API uses - read / write on the NeuroMEP
// database and nothing else. The root account (MONGO_INITDB_ROOT_*) is kept for administration.
const user = process.env.MONGO_APP_USERNAME;
const pwd = process.env.MONGO_APP_PASSWORD;
const dbName = process.env.MONGO_APP_DB || 'neuromep';
if (!user || !pwd) throw new Error('MONGO_APP_USERNAME and MONGO_APP_PASSWORD must be set.');

db.getSiblingDB('admin').createUser({
  user,
  pwd,
  roles: [{ role: 'readWrite', db: dbName }],
});
print(`neuromep-db: created user ${user} (readWrite on ${dbName})`);
