import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { addColumn } from "@landed/backend/db/add-column";

// The schema bootstrap adds late columns with `PRAGMA table_info` → `ALTER TABLE ADD COLUMN`, which
// is check-then-act and therefore racy across PROCESSES. `next build` collects page data in parallel
// workers, each importing db/index.ts and each running the bootstrap: on a fresh DB they all observe
// the column missing, and everyone after the winner dies with "duplicate column name".
//
// It never fires on an established DB (the column already exists, so the guard short-circuits), which
// is why `npm run check` — typecheck + boundary + tests, no build — has never caught it.

const table = (db: InstanceType<typeof Database>) => {
  db.exec("CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
  return db;
};

test("adds the column when it is genuinely missing", () => {
  const db = table(new Database(":memory:"));
  addColumn(db, "ALTER TABLE companies ADD COLUMN watchlist INTEGER NOT NULL DEFAULT 0");
  const cols = (db.prepare("PRAGMA table_info(companies)").all() as { name: string }[]).map((r) => r.name);
  assert.ok(cols.includes("watchlist"));
  db.close();
});

test("a second writer that lost the race is a no-op, not a crash", () => {
  const db = table(new Database(":memory:"));
  // Both "workers" read table_info before either wrote — both believe the column is missing.
  addColumn(db, "ALTER TABLE companies ADD COLUMN watchlist INTEGER NOT NULL DEFAULT 0");
  assert.doesNotThrow(() =>
    addColumn(db, "ALTER TABLE companies ADD COLUMN watchlist INTEGER NOT NULL DEFAULT 0"),
  );
  const cols = (db.prepare("PRAGMA table_info(companies)").all() as { name: string }[]).map((r) => r.name);
  assert.equal(cols.filter((c) => c === "watchlist").length, 1);
  db.close();
});

test("the column keeps the winner's definition — the loser does not clobber it", () => {
  const db = table(new Database(":memory:"));
  addColumn(db, "ALTER TABLE companies ADD COLUMN watchlist INTEGER NOT NULL DEFAULT 0");
  db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme");
  addColumn(db, "ALTER TABLE companies ADD COLUMN watchlist INTEGER NOT NULL DEFAULT 0");
  assert.equal((db.prepare("SELECT watchlist FROM companies").get() as { watchlist: number }).watchlist, 0);
  db.close();
});

test("any OTHER sqlite error still propagates — this must not become a blanket swallow", () => {
  const db = table(new Database(":memory:"));
  assert.throws(() => addColumn(db, "ALTER TABLE does_not_exist ADD COLUMN x TEXT"), /no such table/);
  assert.throws(() => addColumn(db, "this is not valid sql"), /syntax error/);
  db.close();
});
