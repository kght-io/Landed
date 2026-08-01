import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedThread, db, jobs, threads } from "./helpers";
import {
  createJob, claimJob, claimNext, listJobs, submitJobResult,
  reapStuckJobs, setDrainTrigger, takeDrainTrigger, queuedCountForType,
  activeQueueType, inFlightType, sweepQueue,
} from "@landed/backend/jobs/store";
import { recordStep } from "@landed/backend/threads";

beforeEach(reset);

const jobRow = (id: string) => db.select().from(jobs).where(eq(jobs.id, id)).get()!;
// Backdate a job's claim to simulate an abandoned lease (CLAIM_LEASE_MS is 60 min).
const ageClaim = (id: string, minutesAgo: number) =>
  db.update(jobs).set({ claimedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString() }).where(eq(jobs.id, id)).run();
const fit = (id: string, company = "Stripe") =>
  createJob({ id, type: "fit", params: { postings: [{ company }] } });

// ── the heartbeat branch: a job is abandoned when its AGENT goes quiet ────────────────────
// The 60-min lease is sized for the slowest job, so it's far too slow to notice a fast job's
// agent died. The faster signal is threads.lastSeenAt, bumped on every MCP call. These tests
// are the only coverage of that path — nothing else in the suite writes a `threads` row.

test("reapStuckJobs requeues a wip job whose agent went silent, even though its lease is still alive", () => {
  const id = fit("fit-silent");
  const tid = seedThread("th-dead", 20); // last MCP call 20 min ago — past HEARTBEAT_SILENCE_MS (15)
  claimJob(id, "agent-A", tid);
  assert.equal(jobRow(id).status, "wip");
  assert.ok(Date.parse(jobRow(id).claimedAt!) > Date.now() - 60_000, "lease is fresh — only the heartbeat can fire");

  assert.equal(reapStuckJobs(), 1, "one job actioned");
  const row = jobRow(id);
  assert.equal(row.status, "queued", "silent agent → job returned to the queue");
  assert.equal(row.claimedAt, null);
  assert.equal(row.claimedBy, null);
  assert.equal(row.attempts, 1, "the attempt is still counted — the budget is not refunded");
});

test("a job held by a LIVE agent is left alone (a healthy run isn't reclaimed mid-work)", () => {
  const id = fit("fit-live");
  const tid = seedThread("th-alive", 2); // pinged 2 min ago — well inside the silence window
  claimJob(id, "agent-A", tid);

  assert.equal(reapStuckJobs(), 0, "nothing actioned");
  assert.equal(jobRow(id).status, "wip", "still held");
  assert.equal(jobRow(id).claimedBy, "agent-A");
});

test("a wip job with NO thread falls back to the lease alone (the backstop still covers it)", () => {
  const id = fit("fit-threadless");
  claimJob(id, "agent-A"); // no threadId — nothing to heartbeat on
  assert.equal(reapStuckJobs(), 0, "a fresh lease with no thread is not abandoned");
  assert.equal(jobRow(id).status, "wip");

  ageClaim(id, 70); // 70 min > 60 min lease
  assert.equal(reapStuckJobs(), 1, "the lease backstop fires");
  assert.equal(jobRow(id).status, "queued");
});

test("a silent agent's job is dead-lettered once it has burned the attempt budget", () => {
  const id = fit("fit-poison");
  const tid = seedThread("th-gone", 20);
  claimJob(id, "agent-A", tid);
  db.update(jobs).set({ attempts: 3 }).where(eq(jobs.id, id)).run(); // CLAIM_MAX_ATTEMPTS

  assert.equal(reapStuckJobs(), 1);
  const row = jobRow(id);
  assert.equal(row.status, "failed", "poison job dead-lettered rather than looped forever");
  assert.match(row.error ?? "", /auto-failed/);
  assert.equal(row.claimedAt, null, "claim cleared so it doesn't read as in-flight");
});

test("reapStuckJobs is a no-op when there is nothing in flight", () => {
  fit("fit-queued-only");
  assert.equal(reapStuckJobs(), 0);
  assert.equal(jobRow("fit-queued-only").status, "queued", "a queued job is not touched");
});

// ── moved-on release: an agent works ONE job at a time ────────────────────────────────────
// The heartbeat can't catch this case — the agent is alive, it just abandoned the old job.
// No other test passes a threadId to the claim path at all.

test("claiming a second job releases the first one the same agent was still holding", () => {
  const a = fit("fit-abandoned", "Ramp");
  const b = fit("fit-current", "Linear");
  const tid = seedThread("th-worker", 0);

  claimJob(a, "agent-A", tid);
  assert.equal(jobRow(a).status, "wip");

  // Same thread claims another job — it can only be working one, so `a` was abandoned.
  claimJob(b, "agent-A", tid);
  assert.equal(jobRow(b).status, "wip", "the new job is held");
  assert.equal(jobRow(a).status, "queued", "the old job is released immediately, not after the 60-min lease");
  assert.equal(jobRow(a).claimedBy, null);
});

test("a DIFFERENT agent claiming does not disturb the first agent's job", () => {
  const a = fit("fit-agent-a", "Ramp");
  const b = fit("fit-agent-b", "Linear");
  claimJob(a, "agent-A", seedThread("th-a", 0));
  claimJob(b, "agent-B", seedThread("th-b", 0));

  assert.equal(jobRow(a).status, "wip", "agent A keeps its job");
  assert.equal(jobRow(b).status, "wip", "agent B holds its own");
});

test("the claim path stamps the job with the agent session that took it", () => {
  const id = fit("fit-stamped");
  claimJob(id, "agent-A", seedThread("th-stamp", 0));
  assert.equal(jobRow(id).threadId, "th-stamp");

  const next = fit("fit-stamped-2", "Notion");
  assert.equal(claimNext("agent-A", "fit", "th-stamp")?.id, next, "claimNext stamps too");
  assert.equal(jobRow(next).threadId, "th-stamp");
});

// ── the app → agent wake signal ───────────────────────────────────────────────────────────
// Clicking "Drain" sets a one-shot trigger; the waiting agent's next poll consumes it.

test("the drain trigger fires exactly once", () => {
  assert.equal(takeDrainTrigger("fit"), false, "nothing pending before it's set");
  setDrainTrigger("fit");
  assert.equal(takeDrainTrigger("fit"), true, "the waiting agent wakes");
  assert.equal(takeDrainTrigger("fit"), false, "and it does not fire a second time");
});

test("drain triggers are per type — waking one queue does not wake another", () => {
  setDrainTrigger("fit");
  assert.equal(takeDrainTrigger("tailoring"), false, "a tailoring agent stays asleep");
  assert.equal(takeDrainTrigger("fit"), true);
});

test("setting the trigger twice still only fires once (it is a flag, not a counter)", () => {
  setDrainTrigger("inbox-sync");
  setDrainTrigger("inbox-sync");
  assert.equal(takeDrainTrigger("inbox-sync"), true);
  assert.equal(takeDrainTrigger("inbox-sync"), false);
});

// ── queuedCountForType: the long-poll's hot path ──────────────────────────────────────────

test("queuedCountForType counts claimable work, and a stale lease counts as claimable again", () => {
  fit("fit-c1", "A");
  fit("fit-c2", "B");
  createJob({ id: "tailoring-c1", type: "tailoring", params: { postings: [{ id: 1, company: "C" }] } });

  assert.equal(queuedCountForType("fit"), 2);
  assert.equal(queuedCountForType("tailoring"), 1);
  assert.equal(queuedCountForType("prep"), 0, "a type with no work reads zero");

  claimJob("fit-c1", "agent-A");
  assert.equal(queuedCountForType("fit"), 1, "a live lease is not claimable");

  ageClaim("fit-c1", 70);
  assert.equal(queuedCountForType("fit"), 2, "an abandoned lease is claimable again");
});

// ── activeQueueType: which queue a no-type run drains ─────────────────────────────────────
// Rule 1 (in-flight) is covered in claim.test.ts. Rules 2 and 3 are not.

test("with nothing in flight, a run CONTINUES the type it just finished rather than jumping to the oldest", () => {
  const f = fit("fit-older", "A");
  createJob({ id: "tailoring-newer", type: "tailoring", params: { postings: [{ id: 1, company: "B" }] } });
  createJob({ id: "tailoring-newest", type: "tailoring", params: { postings: [{ id: 2, company: "C" }] } });
  db.update(jobs).set({ createdAt: "2026-01-01T00:00:00.000Z" }).where(eq(jobs.id, f)).run();

  // Finish one tailoring job — now nothing is in flight, but tailoring still has open work.
  claimJob("tailoring-newer", "agent-A");
  submitJobResult({ type: "tailoring", jobId: "tailoring-newer", records: [] });

  assert.equal(inFlightType(), null, "nothing is in flight");
  assert.equal(activeQueueType(), "tailoring", "the run stays on the type it was draining, not the older fit job");
});

test("once the finished type has no work left, the run falls back to the OLDEST open job", () => {
  const f = fit("fit-oldest", "A");
  createJob({ id: "tailoring-only", type: "tailoring", params: { postings: [{ id: 1, company: "B" }] } });
  db.update(jobs).set({ createdAt: "2026-01-01T00:00:00.000Z" }).where(eq(jobs.id, f)).run();

  claimJob("tailoring-only", "agent-A");
  submitJobResult({ type: "tailoring", jobId: "tailoring-only", records: [] });

  assert.equal(activeQueueType(), "fit", "tailoring is drained → fall through to the oldest open job");
});

test("activeQueueType is null when the ledger has no open work", () => {
  const id = fit("fit-done");
  claimJob(id, "agent-A");
  submitJobResult({ type: "fit", jobId: id, records: [] });
  assert.equal(activeQueueType(), null, "history alone does not make a queue active");
});

// ── createJob supersede: a re-queue is a FRESH run ────────────────────────────────────────

test("re-queuing an already-ingested job clears the recorded result, not just the claim", () => {
  const id = fit("fit-supersede");
  claimJob(id, "agent-A");
  submitJobResult({ type: "fit", jobId: id, records: [{ company: "Stripe" }] });

  const done = jobRow(id);
  assert.equal(done.status, "ingested");
  assert.ok(done.ingestedAt && done.result && done.summary, "the finished run is on file");

  fit("fit-supersede"); // same id → supersede
  const fresh = jobRow(id);
  assert.equal(fresh.status, "queued", "back to pending");
  assert.equal(fresh.ingestedAt, null, "the prior run's timestamp is cleared");
  assert.equal(fresh.result, null, "the prior records are cleared — this is a new run, not an append");
  assert.equal(fresh.summary, null);
  assert.equal(fresh.attempts, 0, "the retry budget is restored");
  assert.equal(fresh.error, null);
});

test("re-queuing a dead-lettered job gives it a fresh retry budget", () => {
  const id = fit("fit-revive");
  db.update(jobs).set({ status: "failed", attempts: 3, error: "auto-failed: stuck" }).where(eq(jobs.id, id)).run();

  fit("fit-revive");
  const row = jobRow(id);
  assert.equal(row.status, "queued");
  assert.equal(row.attempts, 0, "a hand re-queue is not instantly re-failed");
  assert.equal(row.error, null, "the dead-letter reason is cleared");
  assert.ok(claimJob(id, "agent-A"), "and it is claimable again");
});

test("a re-queue does NOT reset the job's age unless it is a genuine user re-submission", () => {
  const id = fit("fit-age");
  db.update(jobs).set({ createdAt: "2026-01-01T00:00:00.000Z" }).where(eq(jobs.id, id)).run();

  // The idempotent reconcilers re-assert jobs on every poll — they must not keep resetting the age.
  fit("fit-age");
  assert.equal(jobRow(id).createdAt, "2026-01-01T00:00:00.000Z", "age preserved on an idempotent re-assert");

  createJob({ id, type: "fit", params: { postings: [{ company: "Stripe" }] }, bumpQueuedAt: true });
  assert.ok(Date.parse(jobRow(id).createdAt) > Date.now() - 60_000, "an explicit redo re-stamps the queued time");
});

// ── a synthesized job's age reflects when the agent RAN it, not when we ingested ──────────

test("a job id carrying a timestamp backdates createdAt to that run", () => {
  createJob({ id: "inbox-sync-20260620T2033", type: "inbox-sync", params: {} });
  const expected = new Date("2026-06-20T20:33:00").toISOString();
  assert.equal(jobRow("inbox-sync-20260620T2033").createdAt, expected, "age derived from the id, not from now()");
});

test("a job id with no timestamp is stamped with now", () => {
  fit("fit-no-stamp");
  assert.ok(Date.parse(jobRow("fit-no-stamp").createdAt) > Date.now() - 60_000);
});

// ── the derived status contract listJobs() exposes ────────────────────────────────────────

test("listJobs reports an abandoned lease as queued while the stored row still says wip", () => {
  const id = fit("fit-derived");
  claimJob(id, "agent-A");
  ageClaim(id, 70);

  assert.equal(jobRow(id).status, "wip", "the stored row is untouched");
  assert.equal(listJobs().find((j) => j.id === id)!.status, "queued", "but every consumer sees it as claimable");
});

test("a silent agent's job reads as queued to consumers only AFTER the watchdog runs", () => {
  const id = fit("fit-heartbeat-derived");
  claimJob(id, "agent-A", seedThread("th-quiet", 20));

  // The heartbeat signal lives in reapStuckJobs, not in listJobs' lease-based derivation.
  assert.equal(listJobs().find((j) => j.id === id)!.status, "wip", "the lease is still alive, so listJobs says wip");
  reapStuckJobs();
  assert.equal(listJobs().find((j) => j.id === id)!.status, "queued", "the watchdog is what surfaces it");
});

// ── the write side of the heartbeat: every MCP call keeps the session alive ───────────────

test("recording an MCP call registers the session and bumps its heartbeat and step count", () => {
  recordStep({ threadId: "th-new", tool: "claimNext" });
  const first = db.select().from(threads).where(eq(threads.id, "th-new")).get()!;
  assert.equal(first.steps, 1, "a step arriving before any explicit register still creates the row");

  recordStep({ threadId: "th-new", tool: "submitJobResult" });
  const second = db.select().from(threads).where(eq(threads.id, "th-new")).get()!;
  assert.equal(second.steps, 2, "the count accumulates");
  assert.ok(second.lastSeenAt >= first.lastSeenAt, "the heartbeat moves forward");
});

test("a working agent's activity keeps its job out of the watchdog's reach", () => {
  const id = fit("fit-busy");
  claimJob(id, "agent-A", seedThread("th-busy", 20)); // silent long enough to be reaped…
  recordStep({ threadId: "th-busy", tool: "listApplications" }); // …but it just checked in

  assert.equal(reapStuckJobs(), 0, "the fresh heartbeat spares it");
  assert.equal(jobRow(id).status, "wip");
});

// ── the sweep: every consumer of the queue must see a heartbeat-freed job ─────────────────
// The heartbeat exists to recover an abandoned job in ~15 min instead of waiting out the
// 60-min lease. But `queuedCountForType` (and everything else built on listJobs) derives
// status from the LEASE alone — so without a sweep, the fast signal is invisible to the one
// consumer that most needs it: an agent long-polling for work.

test("a waiting agent sees a job freed by the heartbeat, without waiting out the 60-minute lease", () => {
  const id = fit("fit-waiting");
  claimJob(id, "agent-A", seedThread("th-silent", 20)); // silent agent, but ~40 min of lease left
  assert.equal(queuedCountForType("fit"), 0, "the lease-derived view still hides it");

  sweepQueue();
  assert.equal(queuedCountForType("fit"), 1, "after a sweep the freed job is claimable again");
  assert.equal(jobRow(id).status, "queued");
});

test("sweepQueue reports what it actioned and is safe to call when there is nothing to do", () => {
  assert.deepEqual(sweepQueue(), { reaped: 0, fitRequeued: 0, tailoringRequeued: 0 });

  const id = fit("fit-sweep-count");
  claimJob(id, "agent-A", seedThread("th-sweep", 20));
  assert.equal(sweepQueue().reaped, 1, "the abandoned claim is reported");
  assert.equal(sweepQueue().reaped, 0, "and the sweep is idempotent");
});

test("the heartbeat only counts threads the app has actually seen", () => {
  const id = fit("fit-unknown-thread");
  // A job stamped with a thread that was never registered (no `threads` row at all).
  claimJob(id, "agent-A", "th-never-registered");
  assert.equal(db.select().from(threads).all().length, 0, "no session was ever recorded");

  assert.equal(reapStuckJobs(), 1, "an unknown session counts as silent — the job is not stranded");
  assert.equal(jobRow(id).status, "queued");
});
