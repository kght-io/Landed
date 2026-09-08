import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, seedCandidate, db } from "./helpers";
import { recordFitRun } from "@landed/backend/fitlab/store";
import { fitRuns, fitVerdicts, postings } from "@landed/backend/db/schema";
import { ingestFit } from "@landed/backend/jobs/ingest";
import { eq } from "drizzle-orm";

beforeEach(() => reset());

// What the agent hands back per posting: one verdict per criterion, each with its evidence. The
// agent never sends a score — code computes it. That's the whole point: a number the model invented
// can't be audited, re-weighted, or corrected.
const clean = [
  { criterion: "location", verdict: "met", confidence: 95, evidence: "NYC role, candidate in NYC" },
  { criterion: "yoe-floor", verdict: "met", confidence: 90, evidence: "9 yrs vs 5+ floor" },
  { criterion: "role-discipline", verdict: "met", confidence: 92, evidence: "backend platform work" },
  { criterion: "level-match", verdict: "met", confidence: 88, evidence: "Senior posting, Senior candidate" },
  { criterion: "must-have-coverage", verdict: "met", confidence: 85, evidence: "distributed systems, Go" },
  { criterion: "domain-relevance", verdict: "partial", confidence: 70, evidence: "adjacent domain" },
  { criterion: "seniority-signal", verdict: "met", confidence: 80, evidence: "cross-team leadership" },
  { criterion: "comp-floor", verdict: "na", confidence: 99, evidence: "no range posted" },
];

test("a run and its verdicts are stored, and the score is computed here", () => {
  const id = seedCandidate({ company: "Stripe", title: "Senior SWE", state: "fit_queue" });
  const r = recordFitRun({ postingId: id, company: "Stripe", role: "Senior SWE", jd: "…", verdicts: clean });

  assert.ok(r, "the run was recorded");
  assert.equal(r!.decision, "advance");
  assert.ok(r!.score > 70 && r!.score <= 100, `score ${r!.score} is a real number, not the model's`);

  assert.equal(db.select().from(fitRuns).all().length, 1);
  assert.equal(db.select().from(fitVerdicts).all().length, 8, "one row per criterion — the eval set");
});

test("evidence and confidence survive onto the verdict rows", () => {
  const id = seedCandidate({ company: "Stripe", title: "Senior SWE", state: "fit_queue" });
  recordFitRun({ postingId: id, company: "Stripe", role: "Senior SWE", jd: "…", verdicts: clean });

  const row = db.select().from(fitVerdicts).all().find((v) => v.criterionKey === "location")!;
  assert.equal(row.confidence, 95);
  assert.match(row.evidence!, /NYC/);
  assert.equal(row.humanVerdict, null, "unlabelled until you correct it");
});

// The gate that didn't exist before: a wrong-discipline posting is dropped on the verdict, not
// marked down and left to be hand-discarded.
test("a discipline veto drops the run", () => {
  const id = seedCandidate({ company: "MongoDB", title: "Site Reliability Engineer", state: "fit_queue" });
  const r = recordFitRun({
    postingId: id, company: "MongoDB", role: "SRE", jd: "…",
    verdicts: clean.map((v) => (v.criterion === "role-discipline" ? { ...v, verdict: "unmet" } : v)),
  });
  assert.equal(r!.decision, "drop");
});

// Agent output is untrusted. A verdict naming a criterion that doesn't exist can't be scored and
// must not land in the table the eval set is built from.
test("an unknown criterion is dropped, and the rest still score", () => {
  const id = seedCandidate({ company: "Stripe", title: "Senior SWE", state: "fit_queue" });
  const r = recordFitRun({
    postingId: id, company: "Stripe", role: "Senior SWE", jd: "…",
    verdicts: [...clean, { criterion: "vibes", verdict: "met", confidence: 100, evidence: "trust me" }],
  });
  assert.equal(db.select().from(fitVerdicts).all().length, 8, "the invented criterion is not stored");
  assert.equal(r!.decision, "advance");
});

test("an unrecognized verdict value is rejected rather than guessed", () => {
  const id = seedCandidate({ company: "Stripe", title: "Senior SWE", state: "fit_queue" });
  recordFitRun({
    postingId: id, company: "Stripe", role: "Senior SWE", jd: "…",
    verdicts: [{ criterion: "location", verdict: "probably?", confidence: 50, evidence: "x" }],
  });
  assert.equal(db.select().from(fitVerdicts).all().length, 0);
});

// A run with nothing scorable is not a run — recording it would put a 0 on a posting the agent
// never actually judged.
test("a run with no usable verdicts is not recorded", () => {
  const id = seedCandidate({ company: "Stripe", title: "Senior SWE", state: "fit_queue" });
  assert.equal(recordFitRun({ postingId: id, company: "Stripe", role: "Senior SWE", jd: "…", verdicts: [] }), null);
  assert.equal(db.select().from(fitRuns).all().length, 0);
});

// Re-assessing is a normal thing (a redo, a re-scan). Each assessment is its own run, so the
// verdict history is kept rather than overwritten — that history IS the eval set.
test("re-assessing the same posting adds a run rather than replacing one", () => {
  const id = seedCandidate({ company: "Stripe", title: "Senior SWE", state: "fit_queue" });
  recordFitRun({ postingId: id, company: "Stripe", role: "Senior SWE", jd: "…", verdicts: clean });
  recordFitRun({ postingId: id, company: "Stripe", role: "Senior SWE", jd: "…", verdicts: clean });
  assert.equal(db.select().from(fitRuns).all().length, 2);
});

// ── through the live fit job ──────────────────────────────────────────────────────────────────
// The whole path: an agent result carrying verdicts → recordFitRun → decide() → the posting's score.
test("a fit result with verdicts scores the posting from the verdicts", () => {
  const id = seedCandidate({ company: "Stripe", title: "Senior SWE", state: "fit_queue" });
  ingestFit([{ id, company: "Stripe", role: "Senior SWE", verdicts: clean }]);

  const p = db.select().from(postings).where(eq(postings.id, id)).get()!;
  assert.ok(p.fitScore != null && p.fitScore > 0, "the posting carries the COMPUTED score");
  assert.equal(p.state, "assessed", "and advances out of the queue");
  assert.equal(db.select().from(fitRuns).all().length, 1, "with its verdicts kept for labelling");
});

// The agent is told not to send a score. If one arrives anyway, the computed value wins — a number
// the model invented can't be audited or re-weighted, which is the entire reason for verdicts.
test("a computed score beats a score the agent sent anyway", () => {
  const id = seedCandidate({ company: "Stripe", title: "Senior SWE", state: "fit_queue" });
  ingestFit([{ id, company: "Stripe", role: "Senior SWE", fitScore: 12, verdicts: clean }]);

  const p = db.select().from(postings).where(eq(postings.id, id)).get()!;
  assert.notEqual(p.fitScore, 12, "the agent's number is ignored when verdicts are present");
});

// Back-compat while the playbook rolls out: a result produced before the change still lands.
test("a legacy result with only a score still ingests", () => {
  const id = seedCandidate({ company: "Stripe", title: "Senior SWE", state: "fit_queue" });
  ingestFit([{ id, company: "Stripe", role: "Senior SWE", fitScore: 64 }]);

  const p = db.select().from(postings).where(eq(postings.id, id)).get()!;
  assert.equal(p.fitScore, 64);
  assert.equal(db.select().from(fitRuns).all().length, 0, "but produces no verdict rows to label");
});
