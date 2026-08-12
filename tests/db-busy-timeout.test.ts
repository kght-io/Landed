import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { sqlite } from "@landed/backend/db";

// better-sqlite3 defaults busy_timeout to 5000ms, and that is NOT enough here — this is a real
// production-build failure, not a hypothetical:
//
//  1. `next build` collects page data in PARALLEL workers. Each imports a route, which imports
//     ../db, whose module-level `connection()` runs the ENTIRE bootstrap: dozens of CREATE TABLE /
//     ALTER statements plus a full DROP+CREATE rebuild of every enum trigger. That is seconds of
//     write-locked work, done N times at once against one file — so the workers that lose the race
//     wait out 5s and die. The cloud build failed exactly this way on /api/agents/run, then
//     /api/agents/live.
//  2. Litestream holds long-running read locks while replicating the WAL, so from now on the app
//     also contends with its own backup process.
//
// The fix is a timeout long enough to outlast one full bootstrap, not a faster bootstrap: the work
// is idempotent and only expensive on the first run of any given process.

test("the live connection waits long enough to outlast a concurrent bootstrap", () => {
  const timeout = sqlite.pragma("busy_timeout", { simple: true });
  assert.ok(
    typeof timeout === "number" && timeout >= 30_000,
    `busy_timeout was ${timeout}ms; better-sqlite3's 5000ms default is shorter than a contended bootstrap`,
  );
});

test("a second connection to the same file can still open and read", () => {
  // The bootstrap has already run on `sqlite`. A second handle is what a build worker (or
  // Litestream) looks like — it must not blow up on contention.
  const second = new Database(process.env.DB_PATH!);
  second.pragma("busy_timeout = 5000");
  const n = second.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get() as { n: number };
  assert.ok(n.n > 0, "second connection should see the bootstrapped schema");
  second.close();
});
