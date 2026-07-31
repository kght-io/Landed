import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedCandidate, db, jobs } from "./helpers";
import { createJob, claimJob, claimNext, requeueJob, deleteQueuedJob, listJobs, enqueueFit, reconcileFitQueue, listFitQueue, submitJobResult } from "@landed/core/jobs/store";
import { getPosting } from "@landed/core/db/queries";

beforeEach(reset);

const jobRow = (id: string) => db.select().from(jobs).where(eq(jobs.id, id)).get()!;
// Backdate a job's claim to simulate an abandoned lease (CLAIM_LEASE_MS is 60 min).
const ageClaim = (id: string, minutesAgo: number) =>
  db.update(jobs).set({ claimedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString() }).where(eq(jobs.id, id)).run();

test("claimJob is an atomic take: the first claim wins, a second returns null", () => {
  const id = createJob({ id: "fit-claim-1", type: "fit", params: { postings: [{ company: "Stripe", role: "SWE" }] } });

  const first = claimJob(id, "agent-A");
  assert.ok(first, "first claim succeeds");
  assert.equal(first!.status, "wip");
  assert.equal(first!.claimedBy, "agent-A");
  assert.ok(first!.claimedAt, "claim is timestamped");

  const second = claimJob(id, "agent-B");
  assert.equal(second, null, "a second agent cannot claim an already-wip job");
  assert.equal(jobRow(id).claimedBy, "agent-A", "the original claimant still holds it");
});

test("claimJob defaults the claimant to the agent, and won't claim an ingested job", () => {
  const id = createJob({ id: "fit-claim-2", type: "fit", params: { postings: [{ company: "Linear", role: "Eng" }] } });
  assert.equal(claimJob(id)!.claimedBy, "CoWork");

  // finish it → ingested; a claim must then fail.
  submitJobResult({ type: "fit", jobId: id, records: [] });
  assert.equal(jobRow(id).status, "ingested");
  assert.equal(claimJob(id), null, "an ingested job is not claimable");
});

test("requeueJob returns a stuck wip job to the queue and clears the claim", () => {
  const id = createJob({ id: "tailoring-claim-1", type: "tailoring", params: { postings: [{ id: 1, company: "Stripe" }] } });
  claimJob(id, "agent-A");
  assert.equal(jobRow(id).status, "wip");

  assert.equal(requeueJob(id), true);
  const row = jobRow(id);
  assert.equal(row.status, "queued", "back to queued");
  assert.equal(row.claimedAt, null, "claim timestamp cleared");
  assert.equal(row.claimedBy, null, "claimant cleared");

  // now claimable again by anyone
  assert.ok(claimJob(id, "agent-B"), "a requeued job can be re-claimed");
  // a queued (never-claimed) or ingested job is not requeueable
  assert.equal(requeueJob("does-not-exist"), false);
});

test("createJob re-queue clears a prior claim (a redo of a claimed job resets it)", () => {
  const id = createJob({ id: "fit-claim-3", type: "fit", params: { postings: [{ company: "Ramp" }] } });
  claimJob(id, "agent-A");
  // re-asserting the job (e.g. a redo / re-queue) supersedes the claim
  createJob({ id, type: "fit", params: { postings: [{ company: "Ramp" }] } });
  const row = jobRow(id);
  assert.equal(row.status, "queued");
  assert.equal(row.claimedAt, null);
  assert.equal(row.claimedBy, null);
});

test("a claimed (wip) fit job still covers its candidate — reconcileFitQueue won't duplicate it", () => {
  const id = seedCandidate({ company: "Notion", title: "Senior Engineer", state: "fit_queue" });
  enqueueFit({ company: "Notion", role: "Senior Engineer", jd: "JD text" });

  // the candidate's fit job exists and is claimed mid-run
  const fitJob = listJobs().find((j) => j.type === "fit")!;
  claimJob(fitJob.id, "agent-A");
  assert.equal(jobRow(fitJob.id).status, "wip");

  // a poll-time self-heal must NOT create a second fit job for the same candidate
  const created = reconcileFitQueue();
  assert.equal(created, 0, "wip fit job already covers the candidate");
  assert.equal(listJobs().filter((j) => j.type === "fit").length, 1, "still exactly one fit job");
  // the wip job still surfaces as pending fit-queue work
  assert.ok(listFitQueue().some((q) => q.jobId === fitJob.id), "wip fit job stays in the pending fit queue");
  assert.ok(getPosting(id), "candidate intact");
});

test("a fresh claim holds: it is NOT reclaimable inside the lease window", () => {
  const id = createJob({ id: "fit-lease-1", type: "fit", params: { postings: [{ company: "Stripe" }] } });
  claimJob(id, "agent-A");
  ageClaim(id, 30); // 30 min < 60 min lease
  assert.equal(claimJob(id, "agent-B"), null, "a live lease cannot be stolen");
  assert.equal(jobRow(id).claimedBy, "agent-A");
  assert.equal(listJobs().find((j) => j.id === id)!.status, "wip", "still reads as wip");
});

test("an expired lease is reclaimable: claimJob wins and re-stamps the claim", () => {
  const id = createJob({ id: "fit-lease-2", type: "fit", params: { postings: [{ company: "Ramp" }] } });
  claimJob(id, "agent-A");
  ageClaim(id, 70); // 70 min > 60 min lease → abandoned

  // listings surface it as pending again
  assert.equal(listJobs().find((j) => j.id === id)!.status, "queued", "stale wip reads back as queued");

  const reclaimed = claimJob(id, "agent-B");
  assert.ok(reclaimed, "an abandoned lease can be reclaimed");
  const row = jobRow(id);
  assert.equal(row.status, "wip");
  assert.equal(row.claimedBy, "agent-B", "the new holder owns it");
  assert.ok(Date.parse(row.claimedAt!) > Date.now() - 60_000, "the lease was re-stamped to now");
});

test("a wip row with a null claimedAt is treated as abandoned (never gets stuck)", () => {
  const id = createJob({ id: "fit-lease-3", type: "fit", params: { postings: [{ company: "Linear" }] } });
  claimJob(id, "agent-A");
  db.update(jobs).set({ claimedAt: null }).where(eq(jobs.id, id)).run();
  assert.ok(claimJob(id, "agent-B"), "a wip row missing its claim stamp is reclaimable");
  assert.equal(jobRow(id).claimedBy, "agent-B");
});

test("an abandoned lease is removable via the queue X (deleteQueuedJob matches the stale wip row)", () => {
  const id = createJob({ id: "fit-lease-4", type: "fit", params: { postings: [{ company: "Notion" }] } });
  claimJob(id, "agent-A");
  ageClaim(id, 70);
  assert.equal(deleteQueuedJob(id), true, "a stale claim deletes like a queued row");
  assert.equal(db.select().from(jobs).where(eq(jobs.id, id)).get(), undefined, "row is gone");

  // a live (fresh) claim is NOT removable
  const live = createJob({ id: "fit-lease-5", type: "fit", params: { postings: [{ company: "Vercel" }] } });
  claimJob(live, "agent-A");
  assert.equal(deleteQueuedJob(live), false, "a live wip job cannot be removed via the X");
});

test("submitJobResult ignores a duplicate submit on an already-ingested job (no stale clobber)", () => {
  const id = createJob({ id: "inbox-dup-1", type: "inbox-sync", params: {} });
  claimJob(id, "agent-A");

  // first finish wins and is recorded
  const first = submitJobResult({ type: "inbox-sync", jobId: id, records: [], createdBy: "agent-B" });
  assert.equal(jobRow(id).status, "ingested");
  const recorded = jobRow(id);

  // a late, second submit on the same id must NOT overwrite the recorded run
  const dup = submitJobResult({ type: "inbox-sync", jobId: id, records: [{ stale: true }], createdBy: "agent-A" });
  assert.equal(dup.summary, first.summary, "duplicate returns the on-file summary");
  const after = jobRow(id);
  assert.equal(after.ingestedAt, recorded.ingestedAt, "ingestedAt unchanged — not re-ingested");
  assert.equal(after.result, recorded.result, "the stale records did not clobber the recorded result");
});

// --- claimNext: lease the next job + its work content in one call -------------------------

test("claimNext leases the OLDEST queued job, returns it with task/params, and flips it to wip", () => {
  const older = createJob({ id: "fit-old", type: "fit", params: { postings: [{ company: "Stripe" }] } });
  const newer = createJob({ id: "fit-new", type: "fit", params: { postings: [{ company: "Ramp" }] } });
  // make `older` genuinely older (createdAt drives the ordering)
  db.update(jobs).set({ createdAt: "2026-01-01T00:00:00.000Z" }).where(eq(jobs.id, older)).run();
  db.update(jobs).set({ createdAt: "2026-02-01T00:00:00.000Z" }).where(eq(jobs.id, newer)).run();

  const job = claimNext("agent-A");
  assert.equal(job?.id, older, "oldest queued job leased first");
  assert.equal(job?.status, "wip", "returned already claimed");
  assert.equal(job?.claimedBy, "agent-A");
  assert.ok(job?.params, "work content (params) handed back on the lease");
  assert.equal(jobRow(older).status, "wip", "persisted as wip");
});

test("claimNext skips a live lease and takes the next claimable job; returns null when none left", () => {
  const a = createJob({ id: "fit-a", type: "fit", params: { postings: [{ company: "A" }] } });
  const b = createJob({ id: "fit-b", type: "fit", params: { postings: [{ company: "B" }] } });
  claimJob(a, "agent-A"); // a is live-wip → not claimable

  const job = claimNext("agent-B");
  assert.equal(job?.id, b, "the only remaining queued job is leased");

  claimJob(b, "agent-B"); // belt-and-suspenders (claimNext already took it)
  assert.equal(claimNext("agent-C"), null, "nothing claimable → null");
});

// --- one type at a time: a clearing session drains a whole type before the next ----------

test("claimNext drains one job type fully before starting another (no interleaving)", () => {
  const f1 = createJob({ id: "fit-1", type: "fit", params: { postings: [{ company: "A" }] } });
  const t1 = createJob({ id: "tailoring-1", type: "tailoring", params: { postings: [{ id: 1, company: "B" }] } });
  const f2 = createJob({ id: "fit-2", type: "fit", params: { postings: [{ company: "C" }] } });
  // createdAt order interleaves the types: fit, tailoring, fit.
  db.update(jobs).set({ createdAt: "2026-01-01T00:00:00.000Z" }).where(eq(jobs.id, f1)).run();
  db.update(jobs).set({ createdAt: "2026-02-01T00:00:00.000Z" }).where(eq(jobs.id, t1)).run();
  db.update(jobs).set({ createdAt: "2026-03-01T00:00:00.000Z" }).where(eq(jobs.id, f2)).run();

  const order: string[] = [];
  let job = claimNext("agent-A");
  while (job) {
    order.push(job.type);
    submitJobResult({ type: job.type, jobId: job.id, records: [] });
    job = claimNext("agent-A");
  }
  // Both fit jobs clear before the (older) tailoring job — type grouping beats raw FIFO.
  assert.deepEqual(order, ["fit", "fit", "tailoring"]);
});

test("claimJob allows any type — different types may run in parallel", () => {
  const f1 = createJob({ id: "fit-active", type: "fit", params: { postings: [{ company: "A" }] } });
  const t1 = createJob({ id: "tailoring-parallel", type: "tailoring", params: { postings: [{ id: 1, company: "B" }] } });

  // Start fit, then start tailoring concurrently — both claim (parallel runs across types).
  assert.ok(claimJob(f1, "agent-A"), "fit claims");
  assert.ok(claimJob(t1, "agent-B"), "tailoring claims in parallel while fit is in flight");
  assert.equal(jobRow(f1).status, "wip");
  assert.equal(jobRow(t1).status, "wip");
});

test("claimNext({ type }) drains a chosen queue, and a different type runs in parallel", () => {
  const f1 = createJob({ id: "fit-older", type: "fit", params: { postings: [{ company: "A" }] } });
  const t1 = createJob({ id: "tailoring-newer", type: "tailoring", params: { postings: [{ id: 1, company: "B" }] } });
  db.update(jobs).set({ createdAt: "2026-01-01T00:00:00.000Z" }).where(eq(jobs.id, f1)).run();
  db.update(jobs).set({ createdAt: "2026-02-01T00:00:00.000Z" }).where(eq(jobs.id, t1)).run();

  // Even though fit is older, asking for tailoring leases the tailoring job.
  const tj = claimNext("agent-A", "tailoring");
  assert.equal(tj?.id, t1, "the requested type is leased, not the oldest");

  // While tailoring is in flight, a second thread asking for fit gets it — parallel across types.
  const fj = claimNext("agent-B", "fit");
  assert.equal(fj?.id, f1, "a different type leases in parallel");
});

test("claimNext with NO type joins the in-flight type (a plain run stays on one type)", () => {
  const f1 = createJob({ id: "fit-inflight", type: "fit", params: { postings: [{ company: "A" }] } });
  const t1 = createJob({ id: "tailoring-waiting", type: "tailoring", params: { postings: [{ id: 1, company: "B" }] } });
  db.update(jobs).set({ createdAt: "2026-01-01T00:00:00.000Z" }).where(eq(jobs.id, f1)).run();
  db.update(jobs).set({ createdAt: "2026-02-01T00:00:00.000Z" }).where(eq(jobs.id, t1)).run();

  claimJob(f1, "agent-A"); // fit in flight
  const more = createJob({ id: "fit-2", type: "fit", params: { postings: [{ company: "C" }] } });
  // A no-type claim joins the in-flight type (fit), not the older-or-other tailoring.
  assert.equal(claimNext("agent-A")?.id, more, "no-type claim stays on the in-flight type");
});

// --- submit gate: a result only lands for a job you hold (claim-first enforced) -----------

test("submitJobResult REJECTS a result for a queued job that was never claimed", () => {
  const id = createJob({ id: "fit-unclaimed", type: "fit", params: { postings: [{ id: 1, company: "Stripe" }] } });
  assert.throws(
    () => submitJobResult({ type: "fit", jobId: id, records: [{ id: 1, company: "Stripe", fitScore: 80 }] }),
    /isn't held by a live claim/,
    "unclaimed submit is refused",
  );
  assert.equal(jobRow(id).status, "queued", "job stays queued — nothing ingested");
});

test("submitJobResult REJECTS a result when the lease expired (may have been reclaimed)", () => {
  const id = createJob({ id: "fit-expired", type: "fit", params: { postings: [{ id: 2, company: "Ramp" }] } });
  claimJob(id, "agent-A");
  ageClaim(id, 70); // lease lapsed
  assert.throws(
    () => submitJobResult({ type: "fit", jobId: id, records: [{ id: 2, company: "Ramp", fitScore: 70 }] }),
    /isn't held by a live claim/,
    "stale-lease submit is refused",
  );
});

test("submitJobResult accepts a result once the job is claimed under a live lease", () => {
  const cid = seedCandidate({ company: "Cursor", title: "Software Engineer", state: "fit_queue" });
  const id = createJob({ id: "fit-ok", type: "fit", params: { postings: [{ id: cid, company: "Cursor", role: "Software Engineer" }] } });
  claimJob(id, "agent-A");
  const out = submitJobResult({ type: "fit", jobId: id, records: [{ id: cid, company: "Cursor", role: "Software Engineer", fitScore: 88, recommendation: "tailor" }] });
  assert.equal(out.type, "fit");
  assert.equal(jobRow(id).status, "ingested", "claimed submit ingests");
});

test("submitJobResult still allows a self-initiated run (no queue row to claim)", () => {
  // jobId names a synthesized ledger entry that was never queued → exempt from the claim gate
  const out = submitJobResult({ type: "inbox-sync", jobId: "inbox-self-1", records: [] });
  assert.equal(out.type, "inbox-sync");
  assert.equal(jobRow("inbox-self-1").status, "ingested");
});

// --- claimNext dead-letters poison jobs so a drain loop can terminate ----------------------
// A job a runner can never complete (e.g. a browser-only `leveling` job in a headless context)
// used to re-lease forever — claimNext never reaped it, so the drain could never reach "no job".

test("claimNext dead-letters a poison job (claimed to the attempt budget, no result) → drain reaches 'no job'", () => {
  const id = createJob({ id: "leveling-poison", type: "leveling", params: { company: "Snowflake" } });
  // Simulate: claimed up to the budget but never produced a result, and the lease has since lapsed.
  db.update(jobs).set({ status: "wip", attempts: 3, claimedBy: "agent", claimedAt: new Date(Date.now() - 90 * 60_000).toISOString() }).where(eq(jobs.id, id)).run();

  const got = claimNext("agent-B", "leveling");
  assert.equal(got, null, "nothing claimable — the drain terminates honestly");
  const row = jobRow(id);
  assert.equal(row.status, "failed", "the poison job was dead-lettered");
  assert.match(row.error ?? "", /auto-failed/);
});

test("claimNext reclaims an abandoned job that still has attempt budget (not dead-lettered)", () => {
  const id = createJob({ id: "leveling-retry", type: "leveling", params: { company: "Acme" } });
  db.update(jobs).set({ status: "wip", attempts: 1, claimedBy: "agent", claimedAt: new Date(Date.now() - 90 * 60_000).toISOString() }).where(eq(jobs.id, id)).run();

  const got = claimNext("agent-C", "leveling");
  assert.equal(got?.id, id, "still under budget → reclaimed, not failed");
  assert.equal(jobRow(id).status, "wip");
});
