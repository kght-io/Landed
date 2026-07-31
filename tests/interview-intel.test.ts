import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedApp, db, jobs } from "./helpers";
import {
  updateApplication, getPosting,
  addInterviewRound, updateInterviewRound, deleteInterviewRound,
} from "@landed/core/db/queries";
import { queuePrepResearch } from "@landed/core/jobs/store";

beforeEach(() => reset());

test("comp + teamNotes round-trip through updateApplication → getPosting", () => {
  const id = seedApp({ company: "Acme", role: "Backend Engineer", status: "interview" });

  updateApplication(id, { comp: "60M Series A · 10yr runway · 200-250k base · 15% bonus", teamNotes: "Rewards platform." });
  let p = getPosting(id)!;
  assert.match(p.comp!, /Series A/);
  assert.match(p.teamNotes!, /Rewards platform/);

  // Clearing is supported (null wipes the column).
  updateApplication(id, { comp: null });
  p = getPosting(id)!;
  assert.equal(p.comp, undefined);
  assert.match(p.teamNotes!, /Rewards platform/); // untouched
});

test("interview round CRUD: add → edit → delete, numbered after existing rounds", () => {
  const id = seedApp({ company: "Globex", status: "interview" });

  let p = addInterviewRound(id, { kind: "technical", notes: "45 min · TS or Python" })!;
  assert.equal(p.interviews?.length, 1);
  const r1 = p.interviews![0];
  assert.equal(r1.kind, "technical");
  assert.equal(r1.round, 1);

  // A second round numbers after the first.
  p = addInterviewRound(id, { kind: "system_design", notes: "User-facing AI product" })!;
  assert.equal(p.interviews?.length, 2);
  assert.equal(p.interviews![1].round, 2);

  // Edit only the provided fields.
  p = updateInterviewRound(r1.id!, { outcome: "passed" })!;
  const edited = p.interviews!.find((r) => r.id === r1.id)!;
  assert.equal(edited.outcome, "passed");
  assert.equal(edited.notes, "45 min · TS or Python"); // unchanged

  // Delete by id.
  p = deleteInterviewRound(r1.id!)!;
  assert.equal(p.interviews?.length, 1);
  assert.equal(p.interviews![0].kind, "system_design");
});

test("queuePrepResearch queues prep-research with the posting's intel as params.intel", () => {
  const id = seedApp({ company: "Acme", role: "Backend Engineer", status: "interview" });
  updateApplication(id, { comp: "Series A · equity $130 strike", teamNotes: "Rewards platform." });
  addInterviewRound(id, { kind: "technical", notes: "75 min live coding" });

  const out = queuePrepResearch(id)!;
  assert.ok(out.jobId.startsWith("prep-research-"));
  assert.equal(out.slug, "acme");

  const job = db.select().from(jobs).where(eq(jobs.id, out.jobId)).get()!;
  assert.equal(job.type, "prep-research");
  assert.equal(job.status, "queued");
  const params = JSON.parse(job.params!);
  assert.equal(params.company, "Acme");
  assert.match(params.intel.comp, /Series A/);
  assert.match(params.intel.teamNotes, /Rewards/);
  assert.equal(params.intel.rounds.length, 1);
  assert.match(params.intel.rounds[0].notes, /live coding/);
  // The task string flags the intel as authoritative for the agent.
  assert.match(job.task!, /authoritative/i);
});

test("queuePrepResearch omits intel when the posting has none", () => {
  const id = seedApp({ company: "TriEdge", status: "interview" });
  const out = queuePrepResearch(id)!;
  const job = db.select().from(jobs).where(eq(jobs.id, out.jobId)).get()!;
  const params = JSON.parse(job.params!);
  assert.equal(params.intel, undefined);
  assert.doesNotMatch(job.task!, /authoritative/i);
});
