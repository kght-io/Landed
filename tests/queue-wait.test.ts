import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedThread, db, jobs } from "./helpers";
import { createJob, claimJob, listJobs, waitForWork, clampWaitMs, setDrainTrigger, takeDrainTrigger } from "@landed/backend/jobs/store";

beforeEach(reset);

const fit = (id: string, company = "Stripe") =>
  createJob({ id, type: "fit", params: { postings: [{ company }] } });

// The long-poll an agent chat sits in. It used to be a loop inside the route handler, which meant
// none of this could be tested — how an agent waits for work is queue semantics, not HTTP.

test("waiting returns immediately when there is already claimable work", async () => {
  fit("fit-ready");
  const r = await waitForWork("fit", { waitMs: 1_000 });
  assert.equal(r.ready, true);
  assert.equal(r.reason, "work");
  assert.equal(r.count, 1);
});

test("waiting wakes on the Drain button even with nothing queued", async () => {
  setDrainTrigger("fit");
  const r = await waitForWork("fit", { waitMs: 1_000 });
  assert.equal(r.ready, true);
  assert.equal(r.reason, "trigger");
  assert.equal(r.count, 0);
  assert.equal(takeDrainTrigger("fit"), false, "the trigger was consumed, so it can't wake twice");
});

test("waiting gives up after waitMs so the caller can loop instead of holding the socket open", async () => {
  const r = await waitForWork("fit", { waitMs: 1_000 });
  assert.equal(r.ready, false);
  assert.equal(r.type, "fit");
});

test("waiting stops early when the client hangs up", async () => {
  const r = await waitForWork("fit", { waitMs: 28_000, signal: AbortSignal.abort() });
  assert.equal(r.ready, false);
  assert.equal(r.aborted, true, "a dead poll is not worth looping for");
});

test("a waiting agent is woken by work another agent abandoned, not just by fresh work", async () => {
  const id = fit("fit-abandoned-wake");
  claimJob(id, "agent-A", seedThread("th-dead-wake", 20)); // silent agent, lease still alive
  // The lease-derived view alone would say `wip` and the waiter would sleep on. The sweep inside
  // the wait loop is what surfaces it.
  const r = await waitForWork("fit", { waitMs: 1_000 });
  assert.equal(r.ready, true);
  assert.equal(r.reason, "work");
  assert.equal(db.select().from(jobs).where(eq(jobs.id, id)).get()!.status, "queued");
});

test("the wait window is clamped so a caller can't hold a request past the client timeout", () => {
  assert.equal(clampWaitMs(5_000), 5_000);
  assert.equal(clampWaitMs(999_999), 28_000, "capped");
  assert.equal(clampWaitMs(10), 1_000, "floored");
  assert.equal(clampWaitMs(null), 25_000, "absent → the default");
  assert.equal(clampWaitMs("garbage"), 25_000, "unparseable → the default");
});

// listJobs' filtering used to live in the route handler, so the agent's claim-first read path
// (`?lean=1`) had no coverage at all.

test("listing filters by effective status, including an abandoned lease reading as queued", () => {
  fit("fit-q1", "A");
  const claimed = fit("fit-q2", "B");
  claimJob(claimed, "agent-A");

  assert.equal(listJobs({ status: "queued" }).length, 1);
  assert.equal(listJobs({ status: "wip" }).length, 1);
  assert.equal(listJobs({ status: "queued,wip" }).length, 2, "the comma-separated form the HTTP surface uses");
  assert.deepEqual(listJobs({ status: ["queued", "wip"] }).map((j) => j.id).sort(), ["fit-q1", "fit-q2"]);
  assert.equal(listJobs({ status: "" }).length, 2, "an empty filter means no filter");
  assert.equal(listJobs().length, 2, "omitted → everything");

  // Once its lease lapses the claimed job is claimable again, and the filter has to agree.
  db.update(jobs).set({ claimedAt: new Date(Date.now() - 70 * 60_000).toISOString() }).where(eq(jobs.id, claimed)).run();
  assert.equal(listJobs({ status: "queued" }).length, 2, "a stale lease filters as queued, not wip");
});

test("the lean read hides work content on QUEUED rows only — you must lease a job to see its task", () => {
  fit("fit-lean-queued", "A");
  const claimed = fit("fit-lean-wip", "B");
  claimJob(claimed, "agent-A");

  const lean = listJobs({ lean: true });
  const queued = lean.find((j) => j.id === "fit-lean-queued")!;
  const wip = lean.find((j) => j.id === "fit-lean-wip")!;

  assert.equal(queued.params, undefined, "a queued row is a claim-first menu entry");
  assert.equal(queued.task, undefined);
  assert.ok(wip.params, "a job you hold hands back its work content");

  // The app's own UI omits `lean` because it renders subjects from params.
  assert.ok(listJobs().find((j) => j.id === "fit-lean-queued")!.params);
});
