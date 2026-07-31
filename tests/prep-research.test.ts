import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { eq, like } from "drizzle-orm";
import { reset, seedApp, db, postings, companies, jobs } from "./helpers";
import { prepQuestions, prepAttempts, prepCompany } from "@landed/backend/db/schema";
import { submitJobResult } from "@landed/backend/jobs/store";
import { updateApplication } from "@landed/backend/db/queries";
import { getCompanyProfile, listQuestions } from "@landed/backend/db/prep";
import { PREP_ROOT, questionsDumpedAt } from "@landed/backend/prep/export-context";

function resetPrep() {
  reset();
  for (const t of [prepAttempts, prepQuestions, prepCompany]) db.delete(t).run();
}
beforeEach(() => resetPrep());

// A shared coding question with prior practice history — the thing reuse must preserve.
function seedLcWithHistory() {
  db.insert(prepQuestions)
    .values({
      id: "lc-23", track: "coding", name: "Merge K Sorted Lists", leetcodeNum: 23,
      difficulty: "Hard", tags: "[]", companies: "[]", content: "{}", sortOrder: 1,
    })
    .run();
  db.insert(prepAttempts)
    .values({ questionId: "lc-23", attemptedAt: "2026-06-10T00:00:00.000Z", durationSec: 900, status: "solved" })
    .run();
}

test("prep-research upserts a profile, reuses a shared question (preserving history), and inserts bespoke ones", () => {
  seedLcWithHistory();

  const out = submitJobResult({
    type: "prep-research",
    jobId: "prep-research-acme",
    records: [
      {
        type: "profile", company: "Acme",
        process: "OA → 2 coding → system design → values.",
        rounds: [{ name: "Online Assessment", focus: "DS&A" }],
        categories: [
          { key: "lc", label: "LeetCode hit list", kind: "coding" },
          { key: "platform", label: "Platform scenarios", kind: "other" },
          { key: "values", label: "Values round", kind: "behavioral" },
        ],
        sources: [{ label: "Glassdoor", url: "https://x" }],
      },
      { type: "question", category: "lc", leetcodeNum: 23, note: "asked in round 2" },
      {
        type: "question", category: "platform", track: "other", name: "Streaming dedup",
        difficulty: "Hard", prompt: "Dedup a high-throughput stream.", content: { why: "their pipeline" },
      },
      { type: "question", category: "values", track: "behavioral", name: "Disagreed with a manager" },
    ],
  });
  assert.equal(out.type, "prep-research");

  // profile persisted with its ordered categories
  const profile = getCompanyProfile("acme");
  assert.ok(profile, "profile created");
  assert.equal(profile!.categories.length, 3);
  assert.equal(profile!.rounds[0].name, "Online Assessment");

  // job recorded as ingested
  assert.equal(db.select().from(jobs).where(eq(jobs.id, "prep-research-acme")).get()?.status, "ingested");

  // the shared LC question was TAGGED onto acme, NOT duplicated, and keeps its attempt history
  const lcRows = db.select().from(prepQuestions).where(eq(prepQuestions.leetcodeNum, 23)).all();
  assert.equal(lcRows.length, 1, "no duplicate LC row");

  const acmeQs = listQuestions({ company: "acme" });
  assert.equal(acmeQs.length, 3, "all three questions visible under the company lens");
  const lc = acmeQs.find((q) => q.leetcodeNum === 23)!;
  assert.equal(lc.companyCategory, "lc");
  assert.equal(lc.companyNote, "asked in round 2");
  assert.equal(lc.timesDone, 1, "prior attempt history preserved");
  assert.equal(lc.bestSec, 900);

  // bespoke ones inserted with their tracks
  assert.equal(acmeQs.find((q) => q.name === "Streaming dedup")!.track, "other");
  assert.equal(acmeQs.find((q) => q.name === "Disagreed with a manager")!.track, "behavioral");

  // and the shared question still appears in the generic coding bank (single source of truth)
  assert.ok(listQuestions({ track: "coding" }).some((q) => q.id === "lc-23"));
});

test("Research questions writes a standalone questions.md (online-research bank) to the asset folder", () => {
  seedApp({ company: "Acme", role: "Backend Engineer", status: "interview" });

  submitJobResult({
    type: "prep-research",
    jobId: "prep-research-acme-questions",
    records: [
      {
        type: "profile", company: "Acme", process: "OA → onsite.",
        rounds: [{ name: "Onsite", focus: "system design" }],
        categories: [{ key: "lc", label: "LeetCode", kind: "coding" }],
        sources: [{ label: "Glassdoor", url: "https://x" }],
      },
      { type: "question", category: "lc", track: "coding", name: "Two Sum", difficulty: "Easy" },
    ],
  });

  const file = path.join(PREP_ROOT, "acme", "questions.md");
  assert.ok(fs.existsSync(file), "questions.md written");
  const body = fs.readFileSync(file, "utf8");
  assert.match(body, /online research/i);   // it's framed as the public-source bank
  assert.match(body, /Two Sum/);             // the researched question is in it
  assert.ok(questionsDumpedAt("acme"));      // and the mtime helper sees it
});

test("prep-research dryRun previews without persisting", () => {
  const out = submitJobResult({
    type: "prep-research",
    records: [
      { type: "profile", company: "Globex", categories: [{ key: "lc", label: "LC", kind: "coding" }] },
      { type: "question", category: "lc", name: "Some bespoke Q" },
    ],
    dryRun: true,
  });
  assert.ok(out.summary);
  assert.equal(getCompanyProfile("globex"), null, "nothing persisted on dryRun");
  assert.equal(db.select().from(prepQuestions).all().length, 0);
});

test("entering the interview stage auto-queues a one-shot prep-research job", () => {
  const id = seedApp({ company: "Initech", role: "Staff Engineer", status: "applied" });
  const companyId = db.select().from(postings).where(eq(postings.id, id)).get()!.companyId;

  updateApplication(id, { status: "interview" });

  const jobId = `prep-research-${companyId}`;
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  assert.ok(job, "prep-research job queued on interview");
  assert.equal(job!.type, "prep-research");
  assert.equal(job!.status, "queued");
  assert.equal(JSON.parse(job!.params ?? "{}").company, "Initech");

  // idempotent: a second move that touches status again must not create a duplicate/second job
  updateApplication(id, { status: "interview" });
  assert.equal(db.select().from(jobs).where(like(jobs.id, "prep-research-%")).all().length, 1);
});

test("auto-trigger is skipped when the company already has a prep profile", () => {
  const id = seedApp({ company: "Hooli", status: "applied" });
  const companyId = db.select().from(postings).where(eq(postings.id, id)).get()!.companyId;
  const slug = db.select().from(companies).where(eq(companies.id, companyId)).get()!.name.toLowerCase();
  db.insert(prepCompany).values({ slug, name: "Hooli" }).run();

  updateApplication(id, { status: "interview" });
  assert.equal(db.select().from(jobs).where(eq(jobs.id, `prep-research-${companyId}`)).get(), undefined);
});
