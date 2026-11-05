#!/bin/bash
# NeuroMEP database entrypoint: a replica set with authentication needs a key file. It is made on
# first start inside the config volume (never baked into the image), then the official MongoDB
# entrypoint runs as usual (root user, init scripts, mongod).
set -euo pipefail

KEYFILE=/data/configdb/keyfile
if [ ! -s "$KEYFILE" ]; then
  echo "neuromep-db: creating the replica-set key file"
  head -c 756 /dev/urandom | base64 -w 0 > "$KEYFILE"
fi
chown mongodb:mongodb "$KEYFILE"
chmod 400 "$KEYFILE"

exec docker-entrypoint.sh "$@"
