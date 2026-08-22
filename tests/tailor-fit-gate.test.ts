// Don't hand out a tailoring job while its posting's fit is still being scored.
//
// Observed in production (posting 912652): fit was queued at 15:51:00 and tailoring at 15:51:06 —
// two deliberate UI actions six seconds apart. Both agents claimed within 12s and ran concurrently.
// Fit landed at 15:52:19; tailoring had already been working blind for 67 seconds and finished at
// 15:54:28. The user asked for a fit assessment and then got a résumé tailored without it.
//
// Fit remains OPTIONAL for tailoring — a funnel "Tailor" that skips fit entirely still works, and
// nothing here waits for a fit job that was never queued. The rule is narrower: if a fit job for
// this posting is actually in flight, the tailor waits for it rather than racing it.
//
// Two halves, both in the claim path:
//   1. the GATE — a tailoring job isn't claimable while its posting's fit job is live
//   2. RESOLVE-AT-CLAIM — the fit record is re-read when the job is handed over, so a fit that
//      landed after enqueue still reaches the agent (params are a snapshot; claim time is later)
import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedCandidate, db, postings, jobs } from "./helpers";
import { createJob, claimNext, claimJob } from "@landed/backend/jobs/store";
import { enqueueTailoring } from "@landed/backend/jobs/enqueue/tailoring";
import { getPosting } from "@landed/backend/db/queries";
import type { FitAssessment } from "@landed/shared/types";

beforeEach(() => reset());

const FIT: FitAssessment = {
  levelMatch: { call: "under-leveled", why: "Series C startup — Staff is the fair aim" },
  recommendation: "tailor",
  gaps: [{ text: "Python/Django", severity: "hard" }],
};

// A posting parked in the tailor stage, with a tailoring job queued for it.
function seedTailorJob(opts?: { scored?: boolean }): number {
  const id = seedCandidate({ company: "Owner", title: "Senior Software Engineer, Backend", state: "tailoring" });
  if (opts?.scored) score(id);
  enqueueTailoring(getPosting(id)!);
  return id;
}

const score = (id: number) =>
  db.update(postings).set({ fitScore: 68, fitDetail: JSON.stringify(FIT) }).where(eq(postings.id, id)).run();

// A fit job for `postingId`, in whatever lifecycle state the test needs.
function seedFitJob(postingId: number, status: "queued" | "ingested" | "failed" = "queued"): string {
  const id = `fit-${postingId}`;
  createJob({ id, type: "fit", params: { postings: [{ id: postingId }] } });
  if (status !== "queued") db.update(jobs).set({ status }).where(eq(jobs.id, id)).run();
  return id;
}

const claimTailoring = () => claimNext("Résumé Tailor", "tailoring", "th_test");

// --- the gate ---------------------------------------------------------------------------------

test("a tailoring job is not handed out while its posting's fit job is still queued", () => {
  const id = seedTailorJob();
  seedFitJob(id, "queued");

  assert.equal(claimTailoring(), null, "the tailor waits rather than racing the fit");
  // And it's still there — gating must not consume, fail, or dead-letter the job.
  const row = db.select().from(jobs).where(eq(jobs.id, `tailoring-app-${id}`)).get();
  assert.equal(row?.status, "queued");
  assert.equal(row?.attempts ?? 0, 0, "a gated job burns no attempt — it was never tried");
});

test("the same job is claimable once the fit job has been ingested", () => {
  const id = seedTailorJob();
  const fitId = seedFitJob(id, "queued");
  assert.equal(claimTailoring(), null);

  db.update(jobs).set({ status: "ingested" }).where(eq(jobs.id, fitId)).run();
  score(id); // the fit result lands on the posting

  const won = claimTailoring();
  assert.equal(won?.id, `tailoring-app-${id}`, "released the moment fit is done");
});

// The gate keys on THIS posting. An unrelated fit job must not stall an unrelated tailor.
test("a fit job for a different posting does not block", () => {
  const mine = seedTailorJob();
  const other = seedCandidate({ company: "Acme", title: "Staff Engineer", state: "fit_queue" });
  seedFitJob(other, "queued");

  assert.equal(claimTailoring()?.id, `tailoring-app-${mine}`);
});

// Fit stays optional: nothing waits for a fit job that was never queued.
test("with no fit job at all, tailoring is claimable immediately — fit is optional", () => {
  const id = seedTailorJob();
  assert.equal(claimTailoring()?.id, `tailoring-app-${id}`);
});

// A dead fit job must not park the tailor forever. `failed` is terminal — stop waiting on it.
test("a dead-lettered fit job does not block the tailor forever", () => {
  const id = seedTailorJob();
  seedFitJob(id, "failed");

  assert.equal(claimTailoring()?.id, `tailoring-app-${id}`, "a failed fit will never land — don't wait for it");
});

// THE DEADLOCK GUARD. A drain run works one job type at a time (the runner's prompt scopes it), so
// a fit job that no fit run ever claims would park its tailoring job forever if the gate had no
// deadline. Past the wait window the tailor proceeds on the JD alone — the documented no-fit path.
test("the gate expires — a long-queued fit job stops blocking rather than parking the tailor forever", () => {
  const id = seedTailorJob();
  const fitId = seedFitJob(id, "queued");
  const longAgo = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // an hour, well past the window
  db.update(jobs).set({ createdAt: longAgo }).where(eq(jobs.id, fitId)).run();

  assert.equal(claimTailoring()?.id, `tailoring-app-${id}`, "waiting is bounded, not indefinite");
});

// An abandoned claim gets reaped back to `queued` before the gate is consulted, so it keeps
// blocking while it's still fresh — correct, it's genuinely re-runnable work — but the deadline
// above still bounds it.
test("a freshly abandoned fit lease still blocks (it was just requeued and will re-run)", () => {
  const id = seedTailorJob();
  const fitId = seedFitJob(id, "queued");
  db.update(jobs).set({ status: "wip", claimedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString() }).where(eq(jobs.id, fitId)).run();

  assert.equal(claimTailoring(), null, "reaped back to queued and still inside the wait window");
});

// A gated tailoring job must not hide OTHER claimable tailoring work behind it.
test("gating one job still lets a later unblocked tailoring job through", () => {
  const blocked = seedTailorJob();
  seedFitJob(blocked, "queued");
  const free = seedCandidate({ company: "Stripe", title: "Staff Engineer", state: "tailoring" });
  enqueueTailoring(getPosting(free)!);

  assert.equal(claimTailoring()?.id, `tailoring-app-${free}`, "skip the gated one, take the next");
});

// --- resolve at claim -------------------------------------------------------------------------

// The production case: the tailoring job was enqueued BEFORE the fit existed, so its params
// snapshot carried no fit. By claim time the record exists — read it again and hand it over.
test("a fit that landed after enqueue is attached when the job is claimed", () => {
  const id = seedTailorJob(); // enqueued unscored — params have no fit
  const before = JSON.parse(db.select().from(jobs).where(eq(jobs.id, `tailoring-app-${id}`)).get()!.params!);
  assert.equal("fit" in before.postings[0], false, "precondition: enqueued without a fit");

  score(id); // fit lands afterwards

  const won = claimJob(`tailoring-app-${id}`, "Résumé Tailor", "th_test");
  const posting = (won?.params?.postings as Record<string, unknown>[])[0];
  assert.ok(posting.fit, "the claim re-reads the fit rather than trusting the enqueue snapshot");
  assert.equal((posting.fit as { score?: number }).score, 68);
  assert.equal((posting.fit as { level?: string }).level, "under-leveled");
});

// The refresh must persist, not just decorate the returned view — the agent, the UI, and any
// re-read of the row have to agree on what this run was given.
test("the refreshed fit is persisted on the job row, not just returned", () => {
  const id = seedTailorJob();
  score(id);
  claimJob(`tailoring-app-${id}`, "Résumé Tailor", "th_test");

  const stored = JSON.parse(db.select().from(jobs).where(eq(jobs.id, `tailoring-app-${id}`)).get()!.params!);
  assert.equal(stored.postings[0].fit.score, 68);
});

// Claiming an unscored posting must stay clean — no empty fit key appearing at claim time either.
test("claiming an unscored posting leaves params without a fit key", () => {
  const id = seedTailorJob();
  const won = claimJob(`tailoring-app-${id}`, "Résumé Tailor", "th_test");
  const posting = (won?.params?.postings as Record<string, unknown>[])[0];
  assert.equal("fit" in posting, false);
});

// Claim-time refresh is tailoring-specific; it must not disturb other job types.
test("claiming a non-tailoring job is untouched by the refresh", () => {
  createJob({ id: "inbox-sync-x", type: "inbox-sync", params: { since: 123 } });
  const won = claimJob("inbox-sync-x", "Inbox Scout", "th_test");
  assert.equal(won?.id, "inbox-sync-x");
  assert.equal(won?.params?.since, 123);
});
