import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedApp, db, postings, jobs } from "./helpers";
import { updateInterviewStatus } from "@landed/backend/jobs/store";

beforeEach(reset);

const companyIdOf = (appId: number) => db.select().from(postings).where(eq(postings.id, appId)).get()!.companyId;
const hasJob = (id: string) => !!db.select().from(jobs).where(eq(jobs.id, id)).get();

test("updateInterviewStatus fans out: inbox-sync once, per-company emails, applied excluded", () => {
  // A: interviewing. Second posting at A (same company) → must dedupe.
  const a = seedApp({ company: "Acme", role: "Backend Engineer", status: "interview" });
  seedApp({ company: "Acme", role: "Platform Engineer", status: "interview" });
  // B: offer → also an interviewing company.
  const b = seedApp({ company: "Bravo", role: "Staff Engineer", status: "offer" });
  // C: applied → not an interviewing company, excluded entirely.
  const c = seedApp({ company: "Charlie", role: "SWE", status: "applied" });

  const res = updateInterviewStatus();

  assert.equal(res.inboxSync, true);
  assert.equal(res.companies, 2); // Acme + Bravo (deduped; Charlie excluded)
  assert.equal(res.emailsQueued, 2); // one per interviewing company
  assert.equal(res.foldersRefreshed, 2); // context.md dumped for both

  // inbox-sync queued exactly once (id is synthesized, so match by type).
  assert.equal(db.select().from(jobs).where(eq(jobs.type, "inbox-sync")).all().length, 1);
  // per-company interview-emails jobs exist.
  assert.ok(hasJob(`interview-emails-${companyIdOf(a)}`));
  assert.ok(hasJob(`interview-emails-${companyIdOf(b)}`));
  // Charlie (applied) got nothing.
  assert.ok(!hasJob(`interview-emails-${companyIdOf(c)}`));
});

test("a second call does not stack a second inbox-sync while one is outstanding", () => {
  seedApp({ company: "Acme", role: "Backend Engineer", status: "interview" });

  const first = updateInterviewStatus();
  assert.equal(first.inboxSync, true);

  const second = updateInterviewStatus();
  assert.equal(second.inboxSync, false); // one already queued → not re-queued
  assert.equal(db.select().from(jobs).where(eq(jobs.type, "inbox-sync")).all().length, 1);
});
