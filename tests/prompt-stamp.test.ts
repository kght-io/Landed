import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedApp, db, jobs } from "./helpers";
import { postings } from "@landed/backend/db/schema";
import { createJob, claimJob, submitJobResult } from "@landed/backend/jobs/store";
import { createPromptVersion, setActivePromptVersion } from "@landed/backend/db/prompts";
import { parseRedoLog } from "@landed/shared/jobs/redolog";

// Which prompt version produced a result is stamped at CLAIM time — the instant the agent commits
// to the run and the moment before it reads the guidance out of getContext. Not at create time (the
// fit reconciler re-asserts createJob on every UI poll, so that would record a poll, not a run), and
// not at ingest time (the claim→ingest gap is exactly when you'd switch versions because the output
// looked bad — mis-attribution correlated with bad output).

beforeEach(reset);

const jobRow = (id: string) => db.select().from(jobs).where(eq(jobs.id, id)).get()!;
const postingRow = (id: number) => db.select().from(postings).where(eq(postings.id, id)).get()!;
const ageClaim = (id: string, minutesAgo: number) =>
  db.update(jobs).set({ claimedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString() }).where(eq(jobs.id, id)).run();

test("claiming a fit job stamps the active prompt version on the job row", () => {
  const v1 = createPromptVersion("fit", "v1 body");
  const v2 = createPromptVersion("fit", "v2 body");
  setActivePromptVersion(v2.id);

  const id = createJob({ id: "fit-1", type: "fit", params: { postings: [{ id: 1, company: "Stripe" }] } });
  assert.equal(jobRow(id).promptVersionId, null, "a queued job carries no stamp — nothing has run yet");

  claimJob(id, "agent-A");
  assert.equal(jobRow(id).promptVersionId, v2.id);
  assert.notEqual(jobRow(id).promptVersionId, v1.id);
});

test("switching the active version mid-run does not rewrite what already ran", () => {
  const v2 = createPromptVersion("fit", "v2 body");
  setActivePromptVersion(v2.id);
  const postingId = seedApp({ company: "Stripe", role: "SWE", status: "discovered" });
  const id = createJob({ id: `fit-${postingId}`, type: "fit", params: { postings: [{ id: postingId, company: "Stripe" }] } });
  claimJob(id, "agent-A");

  // The user reads the output, dislikes it, and switches versions — while the job is still in flight.
  const v3 = createPromptVersion("fit", "v3 body");
  setActivePromptVersion(v3.id);

  submitJobResult({ type: "fit", jobId: id, records: [{ id: postingId, fitScore: 71, summary: "ok" }] });

  assert.equal(postingRow(postingId).fitPromptVersionId, v2.id, "the result belongs to the version that produced it");
  const turn = parseRedoLog(postingRow(postingId).redoLog).at(-1);
  assert.equal(turn?.promptVersionId, v2.id, "the version history carries the stamp too");
});

test("a tailoring result stamps the tailoring column, not the fit one", () => {
  const tv = createPromptVersion("tailoring", "tailor v1");
  const fv = createPromptVersion("fit", "fit v1");
  const postingId = seedApp({ company: "Linear", role: "Eng", status: "tailoring" });
  const id = createJob({ id: `tailoring-app-${postingId}`, type: "tailoring", params: { postings: [{ id: postingId, company: "Linear" }] } });
  claimJob(id, "agent-A");
  submitJobResult({ type: "tailoring", jobId: id, records: [{ id: postingId, slug: "linear/v1", note: "tailored" }] });

  const row = postingRow(postingId);
  assert.equal(row.tailorPromptVersionId, tv.id);
  assert.equal(row.fitPromptVersionId, null, "the fit column is untouched by a tailoring run");
  assert.notEqual(tv.id, fv.id);
});

test("reclaiming an abandoned lease re-stamps — the retry really does read the current guidance", () => {
  const v1 = createPromptVersion("fit", "v1 body");
  const id = createJob({ id: "fit-2", type: "fit", params: { postings: [{ id: 2, company: "Stripe" }] } });
  claimJob(id, "agent-A");
  assert.equal(jobRow(id).promptVersionId, v1.id);

  const v2 = createPromptVersion("fit", "v2 body");
  setActivePromptVersion(v2.id);
  ageClaim(id, 90); // past CLAIM_LEASE_MS — the lease is up for grabs again

  claimJob(id, "agent-B");
  assert.equal(jobRow(id).promptVersionId, v2.id);
});

test("a job type with no versioned prompt is left unstamped", () => {
  createPromptVersion("fit", "v1 body");
  const id = createJob({ id: "inbox-sync-1", type: "inbox-sync", params: {} });
  claimJob(id, "agent-A");
  assert.equal(jobRow(id).promptVersionId, null);
});

test("claiming before any version exists leaves the stamp null rather than failing the run", () => {
  const postingId = seedApp({ company: "Stripe", role: "SWE", status: "discovered" });
  const id = createJob({ id: `fit-${postingId}`, type: "fit", params: { postings: [{ id: postingId }] } });
  claimJob(id, "agent-A");
  submitJobResult({ type: "fit", jobId: id, records: [{ id: postingId, fitScore: 60 }] });

  assert.equal(jobRow(id).promptVersionId, null);
  assert.equal(postingRow(postingId).fitPromptVersionId, null, "unversioned runs are their own baseline group");
});
