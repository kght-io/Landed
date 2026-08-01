import fs from "node:fs";
import { db } from "./index";
import { jobs } from "./schema";
import { getConfig, INBOX_SYNCED_KEY } from "./config-store";
import { isStaleClaimAt } from "@landed/shared/jobs/lease";
import { repoPath } from "../paths";
import { queueTone, syncTone, worstTone, type OpsTone } from "@landed/shared/format/ops";

// "Is the machine working?" — answered from what the app already records, so nothing new has to be
// collected and no telemetry leaves the box. The pipeline pages answer "how is the job search
// going"; this answers "is the thing that runs the job search alive".
//
// Split deliberately: opsSnapshot() is DB-only and takes its clock, so it's hermetic and testable.
// The filesystem readers below (agent journals, disk usage) are separate and composed by the route —
// they'd otherwise drag real on-disk state into the test suite.

export type OpsFailure = {
  id: string;
  type: string;
  error: string | null;
  createdAt: string;
  attempts: number;
};

export type OpsTypeRow = { type: string; queued: number; wip: number; failed: number };

export type OpsSnapshot = {
  generatedAt: string;
  health: OpsTone;
  queue: {
    queued: number;
    wip: number;
    ingested: number;
    failed: number;
    oldestQueuedAt: string | null;
    oldestQueuedAgeMs: number | null;
    tone: OpsTone;
  };
  failures: OpsFailure[];
  inboxSync: { lastSyncedAt: string | null; ageMs: number | null; tone: OpsTone };
  byType: OpsTypeRow[];
};

const MAX_FAILURES = 20; // enough to see a pattern; the ledger on /agents has the full history

export function opsSnapshot(now: Date = new Date()): OpsSnapshot {
  const ms = now.getTime();
  const rows = db.select().from(jobs).all();

  // An expired lease is abandoned work, not work in progress — grade it as queued, exactly as
  // listJobs() does, so this view can never disagree with the queue it's reporting on.
  const effective = rows.map((r) => ({
    ...r,
    effectiveStatus: isStaleClaimAt(r.status, r.claimedAt, ms) ? "queued" : r.status,
  }));

  const count = (s: string) => effective.filter((r) => r.effectiveStatus === s).length;

  // "Waiting since" = when the job was created. A reclaimed job keeps its original createdAt, which
  // is what we want: the age reflects how long the work has gone undone, not how long since the
  // latest failed attempt.
  const waiting = effective
    .filter((r) => r.effectiveStatus === "queued")
    .map((r) => r.createdAt)
    .sort();
  const oldestQueuedAt = waiting[0] ?? null;
  const oldestQueuedAgeMs = oldestQueuedAt ? Math.max(0, ms - Date.parse(oldestQueuedAt)) : null;

  const failedRows = effective.filter((r) => r.effectiveStatus === "failed");
  const failures: OpsFailure[] = failedRows
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, MAX_FAILURES)
    .map((r) => ({ id: r.id, type: r.type, error: r.error, createdAt: r.createdAt, attempts: r.attempts }));

  const queue = {
    queued: count("queued"),
    wip: count("wip"),
    ingested: count("ingested"),
    failed: failedRows.length,
    oldestQueuedAt,
    oldestQueuedAgeMs,
    tone: queueTone({ queued: count("queued"), failed: failedRows.length, oldestQueuedAgeMs }),
  };

  const lastSyncedAt = getConfig(INBOX_SYNCED_KEY);
  const syncAgeMs = lastSyncedAt ? Math.max(0, ms - Date.parse(lastSyncedAt)) : null;
  const inboxSync = { lastSyncedAt, ageMs: syncAgeMs, tone: syncTone(syncAgeMs) };

  // Only types with something OUTSTANDING — an ops view should be empty when all is well, so a
  // completed job type doesn't earn a permanent row that reads like a problem.
  const byTypeMap = new Map<string, OpsTypeRow>();
  for (const r of effective) {
    if (r.effectiveStatus === "ingested") continue;
    const row = byTypeMap.get(r.type) ?? { type: r.type, queued: 0, wip: 0, failed: 0 };
    if (r.effectiveStatus === "queued") row.queued++;
    else if (r.effectiveStatus === "wip") row.wip++;
    else if (r.effectiveStatus === "failed") row.failed++;
    byTypeMap.set(r.type, row);
  }
  const byType = [...byTypeMap.values()]
    .filter((t) => t.queued + t.wip + t.failed > 0)
    .sort((a, b) => b.failed - a.failed || b.queued + b.wip - (a.queued + a.wip) || a.type.localeCompare(b.type));

  return {
    generatedAt: now.toISOString(),
    health: worstTone([queue.tone, inboxSync.tone]),
    queue,
    failures,
    inboxSync,
    byType,
  };
}

// ------------------------------------------------------------------ on-disk state (fs, not the DB)

// Agent run journals moved to ../agents/run-log (agentRunFiles) — they're filesystem state, not DB
// state, and reading them from here made `db` depend on `agents`. The ops route composes the two.

export type OpsFile = { label: string; path: string; bytes: number; note?: string };

// Files that grow without bound. The launchd logs in particular have no rotation — they are the
// thing most likely to quietly eat the disk on an always-on dev server.
export function storageUsage(): OpsFile[] {
  const targets: { label: string; rel: string; note?: string }[] = [
    { label: "Database", rel: "data/jobhunt.db" },
    { label: "DB write-ahead log", rel: "data/jobhunt.db-wal", note: "checkpoints into the DB" },
    { label: "Server log (stdout)", rel: "data/launchd-jobhunt.out.log", note: "no rotation configured" },
    { label: "Server log (stderr)", rel: "data/launchd-jobhunt.err.log", note: "no rotation configured" },
  ];
  const out: OpsFile[] = [];
  for (const t of targets) {
    const full = repoPath(t.rel);
    try {
      out.push({ label: t.label, path: t.rel, bytes: fs.statSync(full).size, note: t.note });
    } catch {
      // absent is fine (fresh clone, or the service has never run) — just don't list it
    }
  }
  return out;
}
