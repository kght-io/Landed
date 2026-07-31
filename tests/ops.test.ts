import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, db, jobs } from "./helpers";
import { appConfig } from "@landed/backend/db/schema";
import { INBOX_SYNCED_KEY } from "@landed/backend/jobs/store";
import { opsSnapshot } from "@landed/backend/db/ops";
import { worstTone, queueTone, syncTone, QUEUE_SLOW_MS, QUEUE_STUCK_MS, SYNC_DUE_MS, SYNC_LATE_MS } from "@landed/shared/ops";

// A fixed "now" so every age is deterministic regardless of when the suite runs.
const NOW = new Date("2026-07-30T12:00:00Z");
const agoMs = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const HOUR = 3_600_000;

beforeEach(() => reset());

function seedJob(o: {
  id: string; type?: string; status?: "queued" | "wip" | "ingested" | "failed";
  createdAt?: string; claimedAt?: string | null; error?: string | null; attempts?: number;
}) {
  db.insert(jobs).values({
    id: o.id,
    type: o.type ?? "fit",
    createdBy: "You",
    status: o.status ?? "queued",
    createdAt: o.createdAt ?? agoMs(60_000),
    claimedAt: o.claimedAt ?? null,
    error: o.error ?? null,
    attempts: o.attempts ?? 0,
  }).run();
}

// ---------------------------------------------------------------- pure grading

test("worstTone reports the most severe signal, and neutral when there's nothing to say", () => {
  assert.equal(worstTone(["good", "warning", "good"]), "warning");
  assert.equal(worstTone(["good", "warning", "critical"]), "critical");
  assert.equal(worstTone(["good", "good"]), "good");
  assert.equal(worstTone([]), "neutral");
});

test("queueTone: a backlog is fine, a backlog nobody is draining is not", () => {
  // Depth alone says nothing — the agent may simply not have run yet.
  assert.equal(queueTone({ queued: 0, failed: 0, oldestQueuedAgeMs: null }), "good");
  assert.equal(queueTone({ queued: 12, failed: 0, oldestQueuedAgeMs: 5 * 60_000 }), "good");
  // Age is the real signal: work sitting unclaimed means no agent is draining it.
  assert.equal(queueTone({ queued: 1, failed: 0, oldestQueuedAgeMs: QUEUE_SLOW_MS + 1 }), "warning");
  assert.equal(queueTone({ queued: 1, failed: 0, oldestQueuedAgeMs: QUEUE_STUCK_MS + 1 }), "critical");
  // A failure is always worth surfacing, even with a healthy queue.
  assert.equal(queueTone({ queued: 0, failed: 1, oldestQueuedAgeMs: null }), "warning");
});

test("syncTone grades the inbox watermark against its daily cadence", () => {
  assert.equal(syncTone(null), "critical", "never synced");
  assert.equal(syncTone(2 * HOUR), "good");
  assert.equal(syncTone(SYNC_DUE_MS + 1), "warning", "missed a day");
  assert.equal(syncTone(SYNC_LATE_MS + 1), "critical", "missed two days");
});

// ------------------------------------------------------------- the DB snapshot

test("opsSnapshot counts the queue by status and finds the oldest waiting job", () => {
  seedJob({ id: "j1", status: "queued", createdAt: agoMs(30 * 60_000) });
  seedJob({ id: "j2", status: "queued", createdAt: agoMs(3 * HOUR) }); // the oldest
  seedJob({ id: "j3", status: "wip", claimedAt: agoMs(5 * 60_000) });
  seedJob({ id: "j4", status: "ingested" });

  const o = opsSnapshot(NOW);
  assert.equal(o.queue.queued, 2);
  assert.equal(o.queue.wip, 1);
  assert.equal(o.queue.ingested, 1);
  assert.equal(o.queue.failed, 0);
  assert.equal(o.queue.oldestQueuedAt, agoMs(3 * HOUR));
  assert.equal(o.queue.oldestQueuedAgeMs, 3 * HOUR);
});

test("a wip job whose lease expired counts as queued — it's abandoned, not in flight", () => {
  // The 60-min claim is a LEASE: past it the job is up for grabs again, and listJobs already
  // reports it as `queued`. Ops must agree, or the view shows work in progress that nobody owns.
  seedJob({ id: "live", status: "wip", createdAt: agoMs(20 * 60_000), claimedAt: agoMs(10 * 60_000) });
  // Claimed 4h ago — well past the 60-min lease — for work created 5h ago.
  seedJob({ id: "abandoned", status: "wip", createdAt: agoMs(5 * HOUR), claimedAt: agoMs(4 * HOUR) });

  const o = opsSnapshot(NOW);
  assert.equal(o.queue.wip, 1, "only the live lease is in flight");
  assert.equal(o.queue.queued, 1, "the expired lease reads back as queued");
  // Age runs from createdAt, not the abandoned claim: what matters is how long the work has gone
  // undone, not how long since the attempt that dropped it.
  assert.equal(o.queue.oldestQueuedAgeMs, 5 * HOUR, "and it's the oldest thing waiting");
});

test("failures surface newest-first with the error the agent left behind", () => {
  seedJob({ id: "f1", type: "linkedin-import", status: "failed", createdAt: agoMs(2 * HOUR), error: "boom", attempts: 3 });
  seedJob({ id: "f2", type: "fit", status: "failed", createdAt: agoMs(30 * 60_000), error: "timeout" });
  seedJob({ id: "ok", status: "ingested" });

  const o = opsSnapshot(NOW);
  assert.equal(o.queue.failed, 2);
  assert.deepEqual(o.failures.map((f) => f.id), ["f2", "f1"], "newest first");
  assert.equal(o.failures[1].type, "linkedin-import");
  assert.equal(o.failures[1].error, "boom");
  assert.equal(o.failures[1].attempts, 3);
});

test("opsSnapshot reads the inbox watermark and ages it", () => {
  db.insert(appConfig).values({ key: INBOX_SYNCED_KEY, value: agoMs(3 * HOUR) }).run();

  const o = opsSnapshot(NOW);
  assert.equal(o.inboxSync.lastSyncedAt, agoMs(3 * HOUR));
  assert.equal(o.inboxSync.ageMs, 3 * HOUR);
  assert.equal(o.inboxSync.tone, "good");
});

test("a never-synced inbox is critical, not silently empty", () => {
  const o = opsSnapshot(NOW);
  assert.equal(o.inboxSync.lastSyncedAt, null);
  assert.equal(o.inboxSync.ageMs, null);
  assert.equal(o.inboxSync.tone, "critical");
  assert.equal(o.health, "critical", "overall health takes the worst signal");
});

test("byType breaks the outstanding work down by job type", () => {
  db.insert(appConfig).values({ key: INBOX_SYNCED_KEY, value: agoMs(HOUR) }).run();
  seedJob({ id: "a", type: "fit", status: "queued" });
  seedJob({ id: "b", type: "fit", status: "queued" });
  seedJob({ id: "c", type: "tailoring", status: "failed", error: "x" });
  seedJob({ id: "d", type: "fit", status: "ingested" });

  const o = opsSnapshot(NOW);
  const fit = o.byType.find((t) => t.type === "fit");
  const tailoring = o.byType.find((t) => t.type === "tailoring");
  assert.equal(fit?.queued, 2);
  assert.equal(fit?.failed, 0);
  assert.equal(tailoring?.failed, 1);
  assert.ok(!o.byType.some((t) => t.queued === 0 && t.wip === 0 && t.failed === 0),
    "types with nothing outstanding are omitted — this is an ops view, not a ledger");
});

test("a healthy system reports good", () => {
  db.insert(appConfig).values({ key: INBOX_SYNCED_KEY, value: agoMs(HOUR) }).run();
  seedJob({ id: "a", status: "queued", createdAt: agoMs(2 * 60_000) });
  seedJob({ id: "b", status: "ingested" });

  const o = opsSnapshot(NOW);
  assert.equal(o.health, "good");
  assert.equal(o.failures.length, 0);
  assert.equal(o.generatedAt, NOW.toISOString());
});
