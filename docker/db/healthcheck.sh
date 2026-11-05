#!/bin/bash
# Healthy = this node is the writable primary of the replica set. On first start the set is not
# initiated yet: initiate it with the host name the API uses (MONGO_REPLICA_HOST, e.g. db:27017).
set -eo pipefail

mongosh --quiet --norc \
  --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin --eval "
    try {
      rs.status();
    } catch (e) {
      if (e.codeName !== 'NotYetInitialized') throw e;
      rs.initiate({
        _id: process.env.MONGO_REPLICA_SET,
        members: [{ _id: 0, host: process.env.MONGO_REPLICA_HOST }],
      });
    }
    if (!db.hello().isWritablePrimary) quit(1);
  "
