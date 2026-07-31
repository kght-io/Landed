import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, db, postings, jobs, seedCandidate } from "./helpers";
import { scannedAction } from "@landed/backend/db/queries";
import { createJob } from "@landed/backend/jobs/store";

beforeEach(() => reset());

const stateOf = (id: number) => db.select().from(postings).where(eq(postings.id, id)).get()!;

// queueOnly hands work to the agent WITHOUT moving the posting's stage — actions decoupled from status.
test("scannedAction queue-fit with queueOnly leaves the stage untouched but returns a fit payload", () => {
  const id = seedCandidate({ company: "Linear", state: "tailored" });
  const r = scannedAction(id, "queue-fit", { queueOnly: true });
  assert.equal(r.ok, true);
  assert.ok(r.fit, "returns a fit payload so the route can enqueue");
  assert.equal(stateOf(id).state, "tailored", "stage is unchanged");
});

test("scannedAction queue-fit WITHOUT queueOnly still advances to fit_queue (status move)", () => {
  const id = seedCandidate({ company: "Ramp", state: "review" });
  scannedAction(id, "queue-fit");
  assert.equal(stateOf(id).state, "fit_queue");
});

test("scannedAction tailor with queueOnly leaves the stage untouched but returns a tailor payload", () => {
  const id = seedCandidate({ company: "Notion", state: "apply_later" });
  const r = scannedAction(id, "tailor", { queueOnly: true });
  assert.equal(r.ok, true);
  assert.ok(r.tailor, "returns a tailor payload so the route can enqueue");
  assert.equal(stateOf(id).state, "apply_later", "stage is unchanged");
});

test("scannedAction tailor WITHOUT queueOnly still enters the tailoring stage", () => {
  const id = seedCandidate({ company: "Stripe", state: "assessed" });
  scannedAction(id, "tailor");
  assert.equal(stateOf(id).state, "tailoring");
});

// The duplicate-in-queue bug: a stable per-posting fit-job id makes a repeat queue collapse onto one
// row instead of stacking two identical jobs. (Mirrors what the /api/scanned route now does.)
test("a stable per-posting fit job id dedups repeat queueing", () => {
  const id = seedCandidate({ company: "Figma", state: "assessed" });
  const params = { postings: [{ id, company: "Figma", role: "SWE" }] };
  createJob({ id: `fit-cand-${id}`, type: "fit", createdBy: "You", params });
  createJob({ id: `fit-cand-${id}`, type: "fit", createdBy: "You", params });
  const fitJobs = db.select().from(jobs).where(eq(jobs.type, "fit")).all().filter((j) => j.id === `fit-cand-${id}`);
  assert.equal(fitJobs.length, 1, "the two clicks collapse onto one queued job");
});
