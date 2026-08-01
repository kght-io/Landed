import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, db, postings, jobs, seedCandidate } from "./helpers";
import { getPosting } from "@landed/backend/db/queries";
import { outstandingFitJobId, enqueueTailoring, syncTailoringJob, createJob, enqueueFit, reconcileFitQueue, deleteQueuedJob } from "@landed/backend/jobs/store";

beforeEach(() => reset());

const tailoringJob = (id: number) => db.select().from(jobs).where(eq(jobs.id, `tailoring-app-${id}`)).get();
const fitJobs = () => db.select().from(jobs).where(eq(jobs.type, "fit")).all();
const stateOf = (id: number) => db.select().from(postings).where(eq(postings.id, id)).get()!.state;

// Every path that queues a posting for fit must land on the SAME row. Before the ids were unified
// each path minted its own scheme (fit-app-<ts36> / fit-cand-<id> / fit-<ts36> / fit-redo-<id>), so
// the same posting could sit in the queue two or three times and the agent would score it twice.
test("every fit-queue path collapses onto one `fit-<postingId>` job", () => {
  const id = seedCandidate({ company: "Figma", title: "Staff Engineer", state: "fit_queue" });

  // 1. the self-heal reconciler (a fit_queue candidate with no job yet)
  assert.equal(reconcileFitQueue(), 1, "reconciler queued the candidate");
  // 2. the funnel's queue-fit (what /api/scanned/:id does)
  createJob({ id: `fit-${id}`, type: "fit", createdBy: "You", params: { postings: [{ id, company: "Figma", role: "Staff Engineer" }] } });
  // 3. the AddFitModal JD-add, which resolves to the same posting by company + role
  enqueueFit({ company: "Figma", role: "Staff Engineer", jd: "Build things." });

  assert.deepEqual(fitJobs().map((j) => j.id), [`fit-${id}`], "one posting → one fit job");
  // and a second reconcile pass must not add another
  assert.equal(reconcileFitQueue(), 0, "already covered");
  assert.equal(fitJobs().length, 1);
});

// Deleting a queued fit job has to move the posting out of `fit_queue` too (JOB_DEFS.fit.onUnqueue),
// or reconcileFitQueue re-creates the job on the next /api/jobs poll and the delete undoes itself.
test("deleting a queued fit job un-queues the posting, and the delete STICKS", () => {
  const id = seedCandidate({ company: "Ramp", title: "Staff Engineer", state: "fit_queue" });
  assert.equal(reconcileFitQueue(), 1);

  assert.equal(deleteQueuedJob(`fit-${id}`), true);
  assert.equal(stateOf(id), "review", "back to the triage list, not stranded in fit_queue");
  assert.equal(reconcileFitQueue(), 0, "the reconciler does NOT resurrect it");
  assert.equal(fitJobs().length, 0);
});

test("outstandingFitJobId finds an outstanding fit job by posting id", () => {
  const id = seedCandidate({ company: "Figma", state: "assessed" });
  createJob({ id: `fit-${id}`, type: "fit", createdBy: "You", params: { postings: [{ id, company: "Figma", role: "SWE" }] } });
  assert.equal(outstandingFitJobId(id), `fit-${id}`);
  assert.equal(outstandingFitJobId(id + 999), null, "no job for a different posting");
});

test("outstandingFitJobId ignores ingested (non-outstanding) fit jobs", () => {
  const id = seedCandidate({ company: "Ramp", state: "assessed" });
  createJob({ id: "fit-done", type: "fit", createdBy: "You", params: { postings: [{ id }] } });
  db.update(jobs).set({ status: "ingested" }).where(eq(jobs.id, "fit-done")).run();
  assert.equal(outstandingFitJobId(id), null);
});

test("syncTailoringJob with keepPending spares a queued tailoring job on a stage exit", () => {
  const id = seedCandidate({ company: "Stripe", state: "tailoring" });
  enqueueTailoring(getPosting(id)!);
  assert.ok(tailoringJob(id), "job queued");

  // Posting leaves the tailor stage (→ applied).
  db.update(postings).set({ state: "applied" }).where(eq(postings.id, id)).run();
  syncTailoringJob(getPosting(id)!, { keepPending: true });
  assert.ok(tailoringJob(id), "kept — the queued job outlives the move");
});

test("syncTailoringJob WITHOUT keepPending drops a queued tailoring job on a stage exit", () => {
  const id = seedCandidate({ company: "Notion", state: "tailoring" });
  enqueueTailoring(getPosting(id)!);
  assert.ok(tailoringJob(id), "job queued");

  db.update(postings).set({ state: "applied" }).where(eq(postings.id, id)).run();
  syncTailoringJob(getPosting(id)!);
  assert.equal(tailoringJob(id), undefined, "dropped on the stage exit");
});
