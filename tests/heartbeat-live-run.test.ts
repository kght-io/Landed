// Don't reap a job out from under an agent that is demonstrably still running.
//
// Observed in production (tailoring-app-912654):
//   16:26:59  claimed tailoring-app-912654 (wip)
//   16:53:08  abandoned (agent silent) → requeued        ← the agent was alive and mid-build
// then its submitJobResult came back 400 "isn't held by a live claim", and it had to re-claim and
// re-send the whole annotated diff. ~$0.37 of pure waste on that job.
//
// The cause: threads.lastSeenAt only ticks on MCP calls, but a tailoring agent legitimately spends
// 20+ minutes between them — writing two dozen find/replace edits, then building the .docx and PDF.
// HEARTBEAT_SILENCE_MS (15 min) then reads "quiet" as "dead".
//
// The heartbeat exists because the app "can't observe the session directly" — but for headless drain
// runs that is no longer true: the runner writes data/agent-runs/<type>.pid and run-log.isAlive()
// probes it. So when a run process for that job's TYPE is alive, the heartbeat's guess is overruled
// by the fact, and the 60-min lease remains the hard backstop.
//
// The liveness probe is INJECTED here rather than exercised through the filesystem: runPaths()
// anchors on the real REPO_ROOT, so writing pid files in a test would litter data/agent-runs/ and
// could clobber the pid of an actually-running agent.
import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedThread, db, jobs } from "./helpers";
import { createJob, claimJob, reapStuckJobs } from "@landed/backend/jobs/store";

beforeEach(reset);

const jobRow = (id: string) => db.select().from(jobs).where(eq(jobs.id, id)).get()!;
const ageClaim = (id: string, minutesAgo: number) =>
  db.update(jobs).set({ claimedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString() }).where(eq(jobs.id, id)).run();

// A tailoring job held by a thread that has been MCP-silent for 20 min — past the 15-min window.
function silentTailorJob(id = "tailoring-app-1"): string {
  createJob({ id, type: "tailoring", params: { postings: [{ id: 1 }] } });
  claimJob(id, "Résumé Tailor", seedThread("th-quiet", 20));
  return id;
}

const alive = () => true;
const dead = () => false;

test("a silent thread is NOT reaped while a run process for its type is alive", () => {
  const id = silentTailorJob();

  assert.equal(reapStuckJobs({ isRunLive: alive }), 0, "the process is alive — the heartbeat's guess is wrong");
  const row = jobRow(id);
  assert.equal(row.status, "wip", "the claim survives, so submitJobResult still works");
  assert.equal(row.claimedBy, "Résumé Tailor");
});

// The pre-existing behavior has to survive: with no live run, silence still means abandoned.
test("a silent thread IS reaped when no run process is alive", () => {
  const id = silentTailorJob();

  assert.equal(reapStuckJobs({ isRunLive: dead }), 1);
  assert.equal(jobRow(id).status, "queued", "no process, no reprieve");
});

// Liveness overrules the HEARTBEAT only. The 60-minute lease is the hard backstop and still fires —
// otherwise a wedged-but-running process could hold a job forever.
test("an expired lease is still reaped even with a live run process", () => {
  const id = silentTailorJob();
  ageClaim(id, 70); // past CLAIM_LEASE_MS (60 min)

  assert.equal(reapStuckJobs({ isRunLive: alive }), 1, "the lease backstop is not overridable");
  assert.equal(jobRow(id).status, "queued");
});

// Liveness is per job type — a live watchlist-scan run says nothing about a tailoring agent.
test("the probe is asked about the job's own type", () => {
  silentTailorJob();
  const asked: string[] = [];
  reapStuckJobs({ isRunLive: (t) => { asked.push(t); return false; } });
  assert.deepEqual(asked, ["tailoring"]);
});

// A live run must also spare a job from the dead-letter branch — burning the attempt budget on a
// healthy agent is how a working job ends up permanently `failed`.
test("a live run also prevents dead-lettering at the attempt cap", () => {
  const id = "tailoring-app-2";
  createJob({ id, type: "tailoring", params: { postings: [{ id: 2 }] } });
  const tid = seedThread("th-quiet2", 20);
  claimJob(id, "Résumé Tailor", tid);
  db.update(jobs).set({ attempts: 3 }).where(eq(jobs.id, id)).run(); // at CLAIM_MAX_ATTEMPTS

  assert.equal(reapStuckJobs({ isRunLive: alive }), 0);
  assert.equal(jobRow(id).status, "wip", "a live agent is not dead-lettered mid-work");

  assert.equal(reapStuckJobs({ isRunLive: dead }), 1);
  assert.equal(jobRow(id).status, "failed", "…but a dead one still is");
});

// Called with no options (every production call site), it must behave exactly as before: there is no
// pid file for this made-up type, so the probe reports not-live and the job is reaped.
test("the default probe keeps the old behavior when no run is live", () => {
  const id = silentTailorJob("tailoring-app-3");
  assert.equal(reapStuckJobs(), 1, "no pid file for this type → reaped, as before");
  assert.equal(jobRow(id).status, "queued");
});
