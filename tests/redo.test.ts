import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedCandidate, db, postings, jobs } from "./helpers";
import { submitJobResult, claimJob, enqueueTailoring, requeueRedo, reconcileTailoringQueue, deleteQueuedJob } from "@landed/core/jobs/store";
import { getPosting } from "@landed/core/db/queries";
import { parseRedoLog, hasPendingRedo } from "@landed/shared/jobs/redolog";

beforeEach(reset);

const jobParams = (id: string) => JSON.parse(db.select().from(jobs).where(eq(jobs.id, id)).get()!.params!);
const rawLog = (id: number) => parseRedoLog(db.select().from(postings).where(eq(postings.id, id)).get()!.redoLog);

test("reconcileTailoringQueue re-queues a tailoring candidate stranded without a live job", () => {
  const id = seedCandidate({ company: "Anthropic", title: "Staff Engineer", state: "tailoring" });
  // Candidate is in `tailoring` with no resume and NO tailoring job (the "Queued for tailoring…"
  // strand): nothing exists for the agent to pick up.
  assert.equal(db.select().from(jobs).where(eq(jobs.id, `tailoring-app-${id}`)).get(), undefined);

  const created = reconcileTailoringQueue();
  assert.equal(created, 1, "the stranded candidate gets a fresh tailoring job");
  const job = db.select().from(jobs).where(eq(jobs.id, `tailoring-app-${id}`)).get()!;
  assert.equal(job.status, "queued");
  assert.match(jobParams(`tailoring-app-${id}`).postings[0].slug, /\/v1$/, "targets a versioned v1 folder");

  // Idempotent: a candidate already covered by a queued job isn't re-queued again.
  assert.equal(reconcileTailoringQueue(), 0, "no duplicate when a live job already covers it");
});

test("submitting a redo bumps the job's queued time (createdAt) so it re-sorts as freshly queued", () => {
  const id = seedCandidate({ company: "Figma", title: "Staff Engineer", state: "tailoring" });
  enqueueTailoring(getPosting(id)!);
  const jid = `tailoring-app-${id}`;

  // Backdate the queued job so a bump is unambiguously detectable.
  const old = "2020-01-01T00:00:00.000Z";
  db.update(jobs).set({ createdAt: old }).where(eq(jobs.id, jid)).run();

  // An idempotent re-assert (sync/reconcile path) must NOT bump the queued time.
  enqueueTailoring(getPosting(id)!);
  assert.equal(db.select().from(jobs).where(eq(jobs.id, jid)).get()!.createdAt, old, "plain enqueue leaves createdAt untouched");

  // A redo IS a fresh user re-submission → createdAt advances to now.
  requeueRedo(id, "tailor", "Lead with platform work.");
  const after = db.select().from(jobs).where(eq(jobs.id, jid)).get()!;
  assert.equal(after.status, "queued");
  assert.ok(after.createdAt > old, "redo bumps createdAt forward");
  assert.ok(Date.now() - Date.parse(after.createdAt) < 60_000, "createdAt is freshly stamped to ~now");
});

test("reconcileTailoringQueue leaves healthy candidates alone (tailored w/o redo, or already queued)", () => {
  // A tailored candidate with no pending redo needs no job.
  const done = seedCandidate({ company: "Ramp", title: "Senior Engineer", state: "tailored" });
  db.update(postings).set({ resumeDir: "ramp-senior-x/v1" }).where(eq(postings.id, done)).run();
  // A tailoring candidate that already has a live job is covered.
  const live = seedCandidate({ company: "Vercel", title: "Engineer", state: "tailoring" });
  enqueueTailoring(getPosting(live)!);

  assert.equal(reconcileTailoringQueue(), 0, "nothing stranded → nothing created");
  // But if that live job is lost, the next reconcile re-queues it.
  deleteQueuedJob(`tailoring-app-${live}`); // removing un-queues the candidate back to assessed…
  db.update(postings).set({ state: "tailoring" }).where(eq(postings.id, live)).run(); // …simulate it stuck in tailoring
  assert.equal(reconcileTailoringQueue(), 1, "a re-stranded candidate is healed");
});

test("tailoring redo accrues versions: v1 → redo note → v2, resumeDir tracks the latest", () => {
  const id = seedCandidate({ company: "Stripe", title: "Staff Engineer", state: "tailoring" });

  // First tailor (v1): the app dictates the versioned target folder.
  enqueueTailoring(getPosting(id)!);
  const v1slug = jobParams(`tailoring-app-${id}`).postings[0].slug;
  assert.match(v1slug, /\/v1$/, "first tailor targets a /v1 folder");

  claimJob(`tailoring-app-${id}`, "agent-A"); // submit gate requires a live lease
  submitJobResult({ type: "tailoring", jobId: `tailoring-app-${id}`, records: [{ id, slug: v1slug, note: "Led with the ledger rewrite." }] });
  let p = getPosting(id)!;
  assert.equal(p.status, "tailored");
  assert.equal(p.resumeDir, v1slug);
  assert.equal(rawLog(id).filter((t) => t.role === "agent").length, 1);

  // Redo with a note → posting STAYS tailored (a tag, not a regression), job re-queued at v2.
  const r = requeueRedo(id, "tailor", "Cut the mobile bullets, lead with distributed systems.");
  assert.equal(r?.version, 2);
  p = getPosting(id)!;
  assert.equal(p.status, "tailored", "redo keeps the tailored stage (shown as a 'Queued for redo' tag)");
  const job = db.select().from(jobs).where(eq(jobs.id, `tailoring-app-${id}`)).get()!;
  assert.equal(job.status, "queued");
  const v2slug = jobParams(`tailoring-app-${id}`).postings[0].slug;
  assert.match(v2slug, /\/v2$/, "redo targets a /v2 folder");
  assert.notEqual(v1slug, v2slug);
  assert.match(job.task!, /Cut the mobile bullets/, "the task replays the redo conversation");
  assert.equal(hasPendingRedo(rawLog(id), "tailor"), true, "tag shows while the redo is in flight");

  // Second tailor (v2) lands → resumeDir advances, log holds the full conversation.
  claimJob(`tailoring-app-${id}`, "agent-A"); // re-queued by the redo → claim the new lease
  submitJobResult({ type: "tailoring", jobId: `tailoring-app-${id}`, records: [{ id, slug: v2slug, note: "Dropped mobile, led with distributed systems." }] });
  p = getPosting(id)!;
  assert.equal(p.resumeDir, v2slug, "resumeDir projects the latest version");
  const log = rawLog(id);
  assert.deepEqual(log.map((t) => t.role), ["agent", "user", "agent"]);
  assert.deepEqual(log.filter((t) => t.role === "agent").map((t) => t.version), [1, 2]);
  assert.equal(log[0].slug, v1slug, "v1 slug preserved in the log");
  assert.equal(hasPendingRedo(log, "tailor"), false, "tag clears once the new version lands");
});

test("tailoring result carries the agent's annotated diff onto the version turn (malformed ops dropped)", () => {
  const id = seedCandidate({ company: "Stripe", title: "Staff Engineer", state: "tailoring" });
  enqueueTailoring(getPosting(id)!);
  const slug = jobParams(`tailoring-app-${id}`).postings[0].slug;

  claimJob(`tailoring-app-${id}`, "agent-A"); // submit gate requires a live lease
  submitJobResult({
    type: "tailoring", jobId: `tailoring-app-${id}`,
    records: [{
      id, slug, note: "Mirrored payments keywords.",
      diff: [
        { type: "eq", text: "You — Engineer" },
        { type: "del", text: "Built internal APIs" },
        { type: "add", text: "Built distributed payment ledgers", comment: "mirrors the JD's 'distributed systems' must-have" },
        { type: "bogus", text: "ignored" },       // bad op type → dropped
        { type: "add", text: 42 },                  // non-string text → dropped
        { type: "eq", text: "trailing", comment: "  " }, // blank comment → kept, comment stripped
      ],
    }],
  });

  const turn = rawLog(id).filter((t) => t.role === "agent").at(-1)!;
  assert.ok(turn.diff, "the version turn carries the annotated diff");
  assert.equal(turn.diff!.length, 4, "malformed ops were dropped");
  const add = turn.diff!.find((o) => o.text.startsWith("Built distributed"))!;
  assert.equal(add.comment, "mirrors the JD's 'distributed systems' must-have");
  assert.equal(turn.diff!.find((o) => o.text === "trailing")!.comment, undefined, "blank comment dropped");
});

test("tailoring result without a diff leaves the turn diff-less (computed fallback)", () => {
  const id = seedCandidate({ company: "Linear", title: "Engineer", state: "tailoring" });
  enqueueTailoring(getPosting(id)!);
  const slug = jobParams(`tailoring-app-${id}`).postings[0].slug;
  claimJob(`tailoring-app-${id}`, "agent-A"); // submit gate requires a live lease
  submitJobResult({ type: "tailoring", jobId: `tailoring-app-${id}`, records: [{ id, slug, note: "Tailored." }] });
  assert.equal(rawLog(id).filter((t) => t.role === "agent").at(-1)!.diff, undefined);
});

test("fit redo keeps the prior assessment as a version", () => {
  const id = seedCandidate({ company: "Linear", title: "Product Engineer", state: "fit_queue" });

  submitJobResult({ type: "fit", jobId: `fit-${id}`, records: [{ id, fitScore: 62, summary: "Solid but under-leveled.", recommendation: "tailor" }] });
  let p = getPosting(id)!;
  assert.equal(p.status, "assessed");
  assert.equal(p.fitScore, 62);

  requeueRedo(id, "fit", "Weight leadership scope over IC depth.");
  const job = db.select().from(jobs).where(eq(jobs.id, `fit-redo-${id}`)).get()!;
  assert.equal(job.status, "queued");
  assert.match(job.task!, /Weight leadership scope/);
  assert.equal(getPosting(id)!.status, "assessed", "a fit redo stays in the fit stage");

  claimJob(`fit-redo-${id}`, "agent-A"); // submit gate requires a live lease
  submitJobResult({ type: "fit", jobId: `fit-redo-${id}`, records: [{ id, fitScore: 78, summary: "Stronger on leadership.", recommendation: "apply" }] });
  p = getPosting(id)!;
  assert.equal(p.fitScore, 78, "live fitScore is the latest version");
  const log = rawLog(id);
  assert.deepEqual(log.map((t) => t.role), ["agent", "user", "agent"]);
  assert.deepEqual(log.filter((t) => t.role === "agent").map((t) => t.fitScore), [62, 78]);
});
