#!/bin/sh
# Container entrypoint: restore-if-needed, then run the app under Litestream.
#
# The restore is what makes a dead machine survivable. A fresh Fly volume mounts EMPTY, so without
# this a replacement machine would boot, find no database, bootstrap an empty schema, and cheerfully
# serve nothing — the backup would exist in R2 and never be used. `-if-db-not-exists` means it only
# ever runs on a genuinely empty volume, so it can't clobber live data; `-if-replica-exists` means a
# first-ever boot with an empty bucket is not an error.
#
# Then `replicate -exec` makes Litestream the parent process and the app its child: one process
# tree, signals forwarded, and replication that cannot outlive the thing it is replicating.
#
# Without R2 credentials the app still boots, unreplicated. That is deliberate — a local
# `docker run`, or the window before secrets are set, should not be a hard failure. It does mean
# "running" is not proof of "backed up": scripts/restore-test.sh is what proves that.
set -e

DB=/app/data/jobhunt.db

if [ -n "$LITESTREAM_R2_BUCKET" ]; then
  echo "litestream: restoring $DB if absent…"
  litestream restore -if-db-not-exists -if-replica-exists "$DB"
  echo "litestream: replicating, starting app"
  exec litestream replicate -exec "npm start"
else
  echo "litestream: LITESTREAM_R2_BUCKET unset — starting app WITHOUT replication"
  exec npm start
fi
