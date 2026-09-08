import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { STARTER_CRITERIA } from "@landed/backend/fitlab/seed";
import { decide } from "@landed/backend/fitlab/decide";
import type { Criterion, VerdictRow } from "@landed/backend/fitlab/types";
import { listCriteria } from "@landed/backend/fitlab/store";
import { fitCriteria } from "@landed/backend/db/schema";
import { reset, db } from "./helpers";

const criteria = (): Criterion[] => STARTER_CRITERIA.map((c) => ({ ...c, active: true }));
const by = (key: string) => criteria().find((c) => c.key === key)!;

const verdict = (criterionKey: string, v: VerdictRow["verdict"], over: Partial<VerdictRow> = {}): VerdictRow => ({
  id: 0, runId: 1, criterionKey, requirement: null,
  type: by(criterionKey).type, verdict: v, confidence: 90,
  evidence: null, reasoning: null, humanVerdict: null, humanNote: null, labeledAt: null,
  ...over,
});

// ── the rubric ────────────────────────────────────────────────────────────────────────────────
test("every criterion has a judging definition and a stable key", () => {
  for (const c of STARTER_CRITERIA) {
    assert.ok(c.key && /^[a-z-]+$/.test(c.key), `${c.key} is a stable slug`);
    assert.ok(c.definition.length > 40, `${c.key} tells the model how to judge`);
  }
  assert.equal(new Set(STARTER_CRITERIA.map((c) => c.key)).size, STARTER_CRITERIA.length, "keys are unique");
});

// The top discard reason by a wide margin is `role` — wrong KIND of engineering (SRE, ML, mobile,
// frontend). The old rubric had nowhere for that to fail: `domain-relevance` is the problem space
// and `must-have-coverage` is whether the candidate clears THEIR bar, which is the opposite question.
// A GATE, not a weighted criterion. With eight criteria, one `must` miss at weight 3 still scores
// 75 and advances — so a weighted discipline miss would have changed nothing. `excludeDisciplines`
// means excluded, and this was 20 of the first 32 hand-discards.
test("discipline is its own criterion, and it vetoes", () => {
  const c = by("role-discipline");
  assert.ok(c, "the rubric can fail a posting for being the wrong discipline");
  assert.equal(c.type, "gate");
  assert.match(c.definition, /partial/i, "and arguable cases go to `partial`, which costs nothing");
});

// Comp is a signal, never a gate. Most postings don't state a range, and a gate that fires on
// "unstated" would drop most of the board on the absence of information.
test("comp is a signal, not a gate", () => {
  const c = by("comp-floor");
  assert.equal(c.type, "signal");
  assert.match(c.definition, /\bna\b/i, "an unstated range must resolve to `na`, not a miss");
});

// The rubric is generic repo source — a candidate's own bar lives in the profile, not in here. This
// repo is public.
test("no criterion hardcodes candidate-specific detail", () => {
  const blob = STARTER_CRITERIA.map((c) => c.definition).join(" ");
  assert.doesNotMatch(blob, /\bAmazon\b|\bL6\b|\bNYC\b|\$\d/, "reads the profile instead of naming a person's details");
  assert.match(blob, /profile/i, "and says so");
});

// ── scoring ───────────────────────────────────────────────────────────────────────────────────
test("a clean run advances", () => {
  const r = decide(criteria(), criteria().map((c) => verdict(c.key, "met")));
  assert.equal(r.score, 100);
  assert.equal(r.decision, "advance");
});

// The whole point of a gate: a location miss drops the posting no matter how good the rest is.
test("a failed gate vetoes regardless of score", () => {
  const vs = criteria().map((c) => verdict(c.key, c.key === "location" ? "unmet" : "met"));
  const r = decide(criteria(), vs);
  assert.equal(r.decision, "drop");
  assert.deepEqual(r.detail.gateVetoes, ["location"]);
});

// A wrong-discipline posting should fall out of `advance` on its own weight — that is the fix for
// the SRE/ML roles that used to score well and get discarded by hand.
test("a wrong-discipline posting is dropped, not merely marked down", () => {
  const miss = decide(criteria(), criteria().map((c) => verdict(c.key, c.key === "role-discipline" ? "unmet" : "met")));
  assert.equal(miss.decision, "drop");
  assert.deepEqual(miss.detail.gateVetoes, ["role-discipline"]);
});

// The escape hatch that keeps the gate safe: an arguable discipline call costs nothing at all.
test("an arguable discipline call is partial and does not veto", () => {
  const r = decide(criteria(), criteria().map((c) => verdict(c.key, c.key === "role-discipline" ? "partial" : "met")));
  assert.equal(r.decision, "advance", "partial on a gate never drops");
});

// `na` means the criterion doesn't apply — an unstated salary must not be scored as a zero, which
// would penalise every posting that simply didn't publish a range.
test("an `na` verdict is excluded from the score, not counted as a miss", () => {
  const withNa = decide(criteria(), criteria().map((c) => verdict(c.key, c.key === "comp-floor" ? "na" : "met")));
  assert.equal(withNa.score, 100, "the rest still scores clean");
});

// Your correction is the ground truth — the score has to recompute off it, or labelling changes
// nothing and the eval set is decorative.
test("a human override drives the score, not the model's verdict", () => {
  const vs = criteria().map((c) =>
    verdict(c.key, "met", c.key === "must-have-coverage" ? { humanVerdict: "unmet" } : {}),
  );
  const r = decide(criteria(), vs);
  assert.ok(r.score < 100, "the override counted");
  const contribution = r.detail.contributions.find((x) => x.key === "must-have-coverage")!;
  assert.equal(contribution.verdict, "unmet", "and it's the override that's recorded");
});

// Low confidence is the routing signal for automation: the model hedged, so a human should look.
test("a low-confidence verdict is flagged for review", () => {
  const vs = criteria().map((c) => verdict(c.key, "met", c.key === "level-match" ? { confidence: 30 } : {}));
  assert.ok(decide(criteria(), vs).detail.uncertain.includes("level-match"));
});

// A verdict a human has already settled is not uncertain, whatever the model's confidence was.
test("a labelled verdict is never flagged uncertain", () => {
  const vs = criteria().map((c) =>
    verdict(c.key, "met", c.key === "level-match" ? { confidence: 10, humanVerdict: "met" } : {}),
  );
  assert.equal(decide(criteria(), vs).detail.uncertain.includes("level-match"), false);
});

// ── seeding an install that already has the old rubric ────────────────────────────────────────
// The rubric grows. `role-discipline` and `comp-floor` were added after six criteria had already
// been seeded here, and the original seed only ran on an EMPTY table — so an existing install would
// have silently kept judging without them.
test("a partially-seeded rubric gains the new criteria without disturbing the old", () => {
  reset();
  // An install that predates the additions, with a weight the user had tuned.
  db.insert(fitCriteria).values({
    key: "level-match", label: "Level match", type: "must", weight: 9,
    definition: "old text", active: true, sortOrder: 2,
  }).run();

  const got = listCriteria();
  assert.ok(got.find((c) => c.key === "role-discipline"), "the new criterion arrives");
  assert.ok(got.find((c) => c.key === "comp-floor"));
  const existing = got.find((c) => c.key === "level-match")!;
  assert.equal(existing.weight, 9, "a tuned weight is never overwritten");
  assert.equal(existing.definition, "old text", "nor is an edited definition");
});

test("seeding is idempotent", () => {
  reset();
  const first = listCriteria().length;
  assert.equal(listCriteria().length, first, "a second read adds nothing");
});
