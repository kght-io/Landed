import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, seedApp, seedCandidate, db, postings, companies } from "./helpers";
import { eq } from "drizzle-orm";
import { interviewNarrowed } from "@landed/shared/agents/match";
import type { PostingRow } from "@landed/backend/db/schema";
import type { IncomingApp } from "@landed/shared/agents/types";

beforeEach(() => reset());

const row = (id: number, title: string, state: PostingRow["state"]): PostingRow =>
  ({ id, title, state, url: null, appliedDate: null } as PostingRow);
const rec = (over: Partial<IncomingApp> = {}): IncomingApp => ({ company: "Reddit", status: "interview", ...over });
const rowsFor = (name: string) => {
  const co = db.select().from(companies).all().find((c) => c.name === name);
  return co ? db.select().from(postings).where(eq(postings.companyId, co.id)).all() : [];
};

// --- the pool an interview email is matched against ------------------------------------------

test("an interview email is matched ONLY against postings already in the interview stage", () => {
  const pool = [
    row(1, "Senior Software Engineer, Ads", "tailoring"),
    row(2, "Staff Engineer", "applied"),
    row(3, "Senior Software Engineer", "interview"),
  ];
  assert.deepEqual(interviewNarrowed(pool, rec())?.map((p) => p.id), [3]);
});

test("all the interview-stage postings stay candidates when there are several", () => {
  const pool = [
    row(1, "Senior Software Engineer", "interview"),
    row(2, "Staff Engineer", "interview"),
    row(3, "Data Scientist", "applied"),
  ];
  assert.deepEqual(interviewNarrowed(pool, rec())?.map((p) => p.id), [1, 2]);
});

test("no interview-stage posting → no narrowing (fall back to the normal pool)", () => {
  const pool = [row(1, "Senior Software Engineer", "applied"), row(2, "Staff Engineer", "tailoring")];
  assert.equal(interviewNarrowed(pool, rec()), null);
});

test("interview rounds or the interviewed flag also count as interview-related", () => {
  const pool = [row(1, "Senior Software Engineer", "interview"), row(2, "Staff Engineer", "applied")];
  assert.deepEqual(interviewNarrowed(pool, rec({ status: "applied", interviews: [{ round: 1 }] }))?.map((p) => p.id), [1]);
  assert.deepEqual(interviewNarrowed(pool, rec({ status: "applied", interviewed: true }))?.map((p) => p.id), [1]);
});

test("a non-interview email (rejection, fresh applied) is NOT narrowed", () => {
  const pool = [row(1, "Senior Software Engineer", "interview"), row(2, "Staff Engineer", "applied")];
  assert.equal(interviewNarrowed(pool, rec({ status: "rejected" })), null);
  assert.equal(interviewNarrowed(pool, rec({ status: "applied" })), null);
});

// --- end to end: the interview posting is the target, prior stages aren't offered -------------

test("an interview email lands on the single interview-stage posting, not the tailoring/applied ones", async () => {
  const { submitJobResult } = await import("@landed/backend/jobs/store");
  const { listPendingMatches } = await import("@landed/backend/db/queries");
  const before = rowsFor("Reddit").length;
  seedCandidate({ company: "Reddit", title: "Senior Software Engineer, Ads", state: "tailoring" });
  seedApp({ company: "Reddit", role: "Growth Engineer", status: "applied" });
  const target = seedApp({ company: "Reddit", role: "Senior Software Engineer", status: "interview" });

  // Role text that matches NOTHING exactly — previously this fanned out over every prior-stage
  // posting as a fuzzy "which one?" approval. With an interview row present it's unambiguous.
  submitJobResult({
    type: "inbox-sync",
    jobId: "inbox-interview",
    records: [{ company: "Reddit", status: "interviewing", role: "Senior SWE (Ads team)", interviews: [{ round: 2, kind: "technical" }] }],
  });

  assert.equal(rowsFor("Reddit").length, before + 3, "never a duplicate posting");
  // One proposed change, and it targets the interview posting — no "which of these 3?" fan-out.
  const pend = listPendingMatches();
  assert.equal(pend.length, 1);
  assert.equal(pend[0].kind, "change");
  assert.deepEqual(pend[0].candidates.map((c) => c.id), [target]);
  assert.equal(db.select().from(postings).where(eq(postings.id, target)).get()!.state, "interview");
});
