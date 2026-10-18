#!/bin/sh
# Container entrypoint. With LITESTREAM_BUCKET set: restore the database from the bucket (if it is not on disk yet and a copy
# exists), then run the server under litestream so every change is replicated. Without it: just run the server.
set -e

SERVER="node --import tsx src/server.ts"

if [ -n "$LITESTREAM_BUCKET" ]; then
  echo "[start] restoring $DB_PATH from the replica (skipped when there is none yet)"
  litestream restore -config /app/litestream.yml -if-db-not-exists -if-replica-exists "$DB_PATH"
  echo "[start] starting the server with replication on"
  exec litestream replicate -config /app/litestream.yml -exec "$SERVER"
fi

echo "[start] LITESTREAM_BUCKET is not set: starting the server without replication"
exec $SERVER
