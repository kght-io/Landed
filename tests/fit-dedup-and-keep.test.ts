import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, db, postings, jobs, seedCandidate } from "./helpers";
import { getPosting } from "@landed/core/db/queries";
import { outstandingFitJobId, enqueueTailoring, syncTailoringJob, createJob } from "@landed/core/jobs/store";

beforeEach(() => reset());

const tailoringJob = (id: number) => db.select().from(jobs).where(eq(jobs.id, `tailoring-app-${id}`)).get();

test("outstandingFitJobId finds an outstanding fit job by posting id, across id schemes", () => {
  const id = seedCandidate({ company: "Figma", state: "assessed" });
  // a JD-add style fit job (generated id, posting carried in params)
  createJob({ id: "fit-app-xyz", type: "fit", createdBy: "You", params: { postings: [{ id, company: "Figma", role: "SWE" }] } });
  assert.equal(outstandingFitJobId(id), "fit-app-xyz");
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
