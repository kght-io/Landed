import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { sqlite } from "@landed/backend/db";
import { health, CORE_TABLES } from "@landed/backend/db/health";

// The readiness probe behind GET /api/health. Every other test in this suite is pure, so none of
// them would notice an app that boots against an unwritable volume or a half-built schema — this is
// the check that would, and scripts/smoke.mjs runs it against a real `next start` in CI.
//
// health() takes its handle for the same reason opsSnapshot() takes its clock: the failure paths
// have to be reachable without vandalising the live connection.

test("a bootstrapped database is healthy", () => {
  const r = health(sqlite);
  assert.equal(r.ok, true);
  assert.equal(r.db.ok, true);
  assert.deepEqual(r.db.missingTables, []);
  // The app's own bootstrap stamps user_version — v3 is the prep-knowledge schema.
  assert.ok((r.db.schemaVersion ?? 0) >= 3, `schemaVersion was ${r.db.schemaVersion}`);
  assert.equal(r.db.error, undefined);
});

test("a database that never got its schema is unhealthy, and names what's missing", () => {
  const empty = new Database(":memory:");
  const r = health(empty);
  assert.equal(r.ok, false);
  assert.equal(r.db.ok, false);
  assert.deepEqual(r.db.missingTables, [...CORE_TABLES]);
  empty.close();
});

test("a database that can't be queried reports the error instead of throwing", () => {
  const closed = new Database(":memory:");
  closed.close();
  const r = health(closed);
  assert.equal(r.ok, false);
  assert.equal(r.db.ok, false);
  assert.ok(r.db.error, "expected an error string");
  // A probe that throws is a probe that answers 500 with a stack trace — it has to survive this.
  assert.equal(r.db.schemaVersion, null);
});
