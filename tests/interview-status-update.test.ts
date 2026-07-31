import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedApp, db, postings, jobs } from "./helpers";
import { prepQuestions, prepAttempts, prepCompany } from "@landed/core/db/schema";
import { updateInterviewStatus } from "@landed/core/jobs/store";
import { canonical } from "@landed/shared/agents/canonical";

// reset() (helpers) doesn't touch the prep_* tables — clear them too so profiles don't leak.
beforeEach(() => {
  reset();
  for (const t of [prepAttempts, prepQuestions, prepCompany]) db.delete(t).run();
});

const companyIdOf = (appId: number) => db.select().from(postings).where(eq(postings.id, appId)).get()!.companyId;
const hasJob = (id: string) => !!db.select().from(jobs).where(eq(jobs.id, id)).get();

test("updateInterviewStatus fans out: inbox-sync once, per-company emails + research-if-new, applied excluded", () => {
  // A: interviewing, never researched. Second posting at A (same company) → must dedupe.
  const a = seedApp({ company: "Acme", role: "Backend Engineer", status: "interview" });
  seedApp({ company: "Acme", role: "Platform Engineer", status: "interview" });
  // B: offer, already researched (seed a prep_company profile → research must be skipped).
  const b = seedApp({ company: "Bravo", role: "Staff Engineer", status: "offer" });
  db.insert(prepCompany).values({ slug: canonical("Bravo")!.key, name: "Bravo" }).run();
  // C: applied → not an interviewing company, excluded entirely.
  const c = seedApp({ company: "Charlie", role: "SWE", status: "applied" });

  const res = updateInterviewStatus();

  assert.equal(res.inboxSync, true);
  assert.equal(res.companies, 2); // Acme + Bravo (deduped; Charlie excluded)
  assert.equal(res.emailsQueued, 2); // one per interviewing company
  assert.equal(res.researchQueued, 1); // only Acme (Bravo already has a profile)
  assert.equal(res.foldersRefreshed, 2); // context.md dumped for both

  // inbox-sync queued exactly once (id is synthesized, so match by type).
  assert.equal(db.select().from(jobs).where(eq(jobs.type, "inbox-sync")).all().length, 1);
  // per-company interview-emails jobs exist.
  assert.ok(hasJob(`interview-emails-${companyIdOf(a)}`));
  assert.ok(hasJob(`interview-emails-${companyIdOf(b)}`));
  // prep-research only for the un-researched company.
  assert.ok(hasJob(`prep-research-${companyIdOf(a)}`));
  assert.ok(!hasJob(`prep-research-${companyIdOf(b)}`));
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
