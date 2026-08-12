import type BetterSqlite3 from "better-sqlite3";
import { sqlite } from "./index";

// "Can this process serve traffic?" — the readiness probe behind GET /api/health, and the target of
// the container healthcheck. Deliberately NOT the same question as ../db/ops.ts's opsSnapshot():
// that one asks "is the job search progressing" and reads the whole queue to answer. A liveness
// probe that drags the query layer in fails for reasons that have nothing to do with liveness, and
// gets polled every 30s forever.
//
// What it actually catches is the deploy failure: a container that booted against an empty or
// unwritable volume, so the DB opened but the schema was never built. That's invisible to every
// other test in this repo, because they're all pure.
//
// Takes its handle (defaulting to the live connection) for the same reason opsSnapshot takes its
// clock — the failure paths stay reachable from tests without touching the real database.

// Not the full table list — enough that a bootstrap which half-ran is caught. These five span the
// schema's independent creation paths in ./index.ts, so a partial boot can't leave all of them
// present.
export const CORE_TABLES = ["companies", "postings", "jobs", "events", "app_config"] as const;

export type HealthReport = {
  ok: boolean;
  db: {
    ok: boolean;
    schemaVersion: number | null;
    missingTables: string[];
    error?: string;
  };
};

export function health(handle: BetterSqlite3.Database = sqlite): HealthReport {
  try {
    const present = new Set(
      (handle.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
        .map((r) => r.name),
    );
    const missingTables = CORE_TABLES.filter((t) => !present.has(t));
    // Stamped by the one-time migrations in ./index.ts. A schema that exists but was never versioned
    // still reports its 0 — the missing-table check is what decides ok.
    const schemaVersion = handle.pragma("user_version", { simple: true }) as number;
    const ok = missingTables.length === 0;
    return { ok, db: { ok, schemaVersion, missingTables } };
  } catch (err) {
    // Everything is caught: a probe that throws answers 500 with a stack trace, which tells an
    // orchestrator nothing and leaks internals to whoever can reach the endpoint.
    return {
      ok: false,
      db: { ok: false, schemaVersion: null, missingTables: [], error: String(err) },
    };
  }
}
