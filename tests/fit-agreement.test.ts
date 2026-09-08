import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, seedCandidate, db } from "./helpers";
import { postings } from "@landed/backend/db/schema";
import { fitAgreement, callbackByFitScore, type CallbackBand } from "@landed/backend/db/pipeline-metrics";
import { eq } from "drizzle-orm";

beforeEach(() => reset());

const RECENT = "2026-09-05T00:00:00.000Z";
const set = (id: number, v: Partial<typeof postings.$inferInsert>) =>
  db.update(postings).set({ scannedAt: RECENT, ...v }).where(eq(postings.id, id)).run();

// ── fit agreement ─────────────────────────────────────────────────────────────────────────────
// Does the score agree with what you did?
//
// The first version of this counted every post-fit drop as a failure, which punished the pipeline
// for working: 13 of 16 drops in the first era were low-scored Anthropic roles — fit rated them 22
// to 63, you agreed and dropped them. That is the assessment succeeding. What matters is whether
// the score and the decision POINT THE SAME WAY, not how many advanced.

test("the four outcomes are counted separately", () => {
  set(seedCandidate({ company: "A", title: "tp", state: "tailoring" }), { fitScore: 82 });
  set(seedCandidate({ company: "B", title: "tn", state: "dismissed" }), { fitScore: 30 });
  set(seedCandidate({ company: "C", title: "fp", state: "dismissed" }), { fitScore: 85 });
  set(seedCandidate({ company: "D", title: "fn", state: "applied" }), { fitScore: 45 });

  const r = fitAgreement({ minDecided: 1 });
  assert.equal(r.truePositives, 1);
  assert.equal(r.trueNegatives, 1);
  assert.equal(r.falsePositives, 1);
  assert.equal(r.falseNegatives, 1);
});

// The lesson that produced this shape: a merged accuracy figure read 72% while recall was 44%,
// because correctly binning obvious rejects is the easy half and there are far more of them. One
// number hid the only failure that costs a job.
test("accuracy is flattered by correct drops; recall is not", () => {
  // Eight obvious rejects, correctly dropped — and one wanted job the score missed.
  for (let i = 0; i < 8; i++) set(seedCandidate({ company: `X${i}`, title: `tn${i}`, state: "dismissed" }), { fitScore: 20 });
  set(seedCandidate({ company: "Y", title: "missed", state: "applied" }), { fitScore: 40 });

  const r = fitAgreement({ minDecided: 1 });
  assert.equal(r.accuracy, 8 / 9, "accuracy looks excellent");
  assert.equal(r.recall, 0, "recall says it missed everything you wanted");
});

// A false negative is a job you WANTED that scored below the bar. It's the expensive direction:
// a false positive costs a full-JD run, this costs the job.
test("a low score you advanced is a false negative", () => {
  set(seedCandidate({ company: "A", title: "rescued", state: "applied" }), { fitScore: 45 });
  const r = fitAgreement({ minDecided: 1 });
  assert.equal(r.falseNegatives, 1);
  assert.equal(r.recall, 0);
});

// A posting discarded at TRIAGE never reached fit, so it says nothing about the assessment.
test("a discard that never reached fit is not counted", () => {
  set(seedCandidate({ company: "A", title: "triage drop", state: "dismissed" }), { dismissReason: "role" });
  assert.equal(fitAgreement({ minDecided: 1 }).decided, 0, "no score → never assessed");
});

test("postings still sitting in fit are not evidence either way", () => {
  set(seedCandidate({ company: "A", title: "waiting", state: "assessed" }), { fitScore: 70 });
  const r = fitAgreement({ minDecided: 1 });
  assert.equal(r.pending, 1);
  assert.equal(r.decided, 0);
});

test("rates are withheld below the decision floor", () => {
  set(seedCandidate({ company: "A", title: "y", state: "applied" }), { fitScore: 80 });
  const r = fitAgreement({ minDecided: 10 });
  assert.equal(r.precision, null);
  assert.equal(r.recall, null);
  assert.equal(r.truePositives, 1, "but the counts are always visible");
});

// ── callback by fit score ─────────────────────────────────────────────────────────────────────
// The only end-to-end truth signal: does a high score actually convert? If an 84 and a 61 call back
// at the same rate, the score isn't measuring anything, however coherent its verdicts look.
test("callback rate is grouped by fit band", () => {
  // 80+ band: one reached an interview, one was rejected.
  set(seedCandidate({ company: "A", title: "a", state: "interview" }), { fitScore: 85, appliedDate: "2026-01-01", interviewed: true });
  set(seedCandidate({ company: "B", title: "b", state: "rejected" }), { fitScore: 82, appliedDate: "2026-01-01" });
  // 40-59 band: rejected without a loop.
  set(seedCandidate({ company: "C", title: "c", state: "rejected" }), { fitScore: 45, appliedDate: "2026-01-01" });

  const rows: CallbackBand[] = callbackByFitScore({ minDecided: 1 });
  const high = rows.find((r) => r.bucket === "80+")!;
  assert.equal(high.decided, 2);
  assert.equal(high.callbacks, 1);
  assert.equal(high.rate, 0.5);
});

// Engagement is checked before any closing state: `state` holds only the LATEST value, so a loop
// that ended in a rejection still reads as "rejected". Counting that as a failure would delete most
// of the positive signal — the same rule callbackOutcome already encodes.
test("a rejection after a real interview still counts as a callback", () => {
  set(seedCandidate({ company: "A", title: "a", state: "rejected" }), { fitScore: 85, appliedDate: "2026-01-01", interviewed: true });
  const high = callbackByFitScore({ minDecided: 1 }).find((r: CallbackBand) => r.bucket === "80+")!;
  assert.equal(high.callbacks, 1, "the loop happened, whatever the outcome");
});

// A band with too few decided applications reports its count but no rate — a callback rate over
// three applications is noise wearing a number.
test("a thin band reports its count without a rate", () => {
  set(seedCandidate({ company: "A", title: "a", state: "applied" }), { fitScore: 85, appliedDate: "2026-01-01" });
  const high = callbackByFitScore({ minDecided: 10 }).find((r: CallbackBand) => r.bucket === "80+")!;
  assert.equal(high.rate, null);
  assert.equal(high.decided >= 0, true);
});

test("unscored applications are excluded — there is no band to put them in", () => {
  set(seedCandidate({ company: "A", title: "a", state: "rejected" }), { appliedDate: "2026-01-01" });
  assert.equal(callbackByFitScore({ minDecided: 1 }).every((r: CallbackBand) => r.decided === 0), true);
});
