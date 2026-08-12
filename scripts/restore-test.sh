#!/bin/sh
# Prove the backup is real. Run INSIDE the container:
#
#   fly ssh console -a landed-ai -C "sh /app/scripts/restore-test.sh"
#
# An untested backup is a hypothesis, and the usual way backup setups fail is that they were quietly
# broken for months while everything looked fine. This restores the R2 replica to a SCRATCH path and
# compares it against the live database, row for row, so the test can be run any day without risking
# the thing it is testing.
#
# It does NOT touch /app/data/jobhunt.db. The destructive test — wipe the volume, confirm the machine
# rebuilds itself on boot — is a separate, deliberate act.
set -e

LIVE=/app/data/jobhunt.db
SCRATCH=/tmp/restore-test.db

echo "── restoring replica to $SCRATCH"
rm -f "$SCRATCH" "$SCRATCH"-wal "$SCRATCH"-shm
litestream restore -config /etc/litestream.yml -o "$SCRATCH" "$LIVE"

echo "── comparing restored copy against live"
node -e '
const Database = require("/app/node_modules/better-sqlite3");
const [live, scratch] = [process.argv[1], process.argv[2]];
// readonly so the comparison cannot perturb the database it is checking
const a = new Database(live, { readonly: true });
const b = new Database(scratch, { readonly: true });

const tables = (db) => db.prepare(
  "SELECT name FROM sqlite_master WHERE type=\x27table\x27 AND name NOT LIKE \x27sqlite_%\x27 ORDER BY name"
).all().map((r) => r.name);

const ta = tables(a), tb = tables(b);
const missing = ta.filter((t) => !tb.includes(t));
if (missing.length) {
  console.error("FAIL: restored copy is missing tables: " + missing.join(", "));
  process.exit(1);
}

let rows = 0, bad = 0;
for (const t of ta) {
  const ca = a.prepare(`SELECT count(*) n FROM "${t}"`).get().n;
  const cb = b.prepare(`SELECT count(*) n FROM "${t}"`).get().n;
  rows += ca;
  if (ca !== cb) { console.error(`   MISMATCH ${t}: live=${ca} restored=${cb}`); bad++; }
  else if (ca > 0) console.log(`   ok ${t}: ${ca}`);
}
if (bad) { console.error(`FAIL: ${bad} table(s) differ`); process.exit(1); }

// An empty database compares equal to an empty restore, which proves nothing. Say so rather than
// printing a green check that means "there was nothing to lose".
if (rows === 0) {
  console.error("INCONCLUSIVE: both are empty — write some rows and run again");
  process.exit(2);
}
console.log(`PASS: ${ta.length} tables, ${rows} rows identical`);
' "$LIVE" "$SCRATCH"

rm -f "$SCRATCH" "$SCRATCH"-wal "$SCRATCH"-shm
