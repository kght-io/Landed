import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, seedCandidate } from "./helpers";
import { evalBoards, POSITIVE_STATES } from "@landed/backend/db/scan-eval";
import { scoreBoards } from "@landed/shared/experiments/ranking";
import { db, postings } from "./helpers";
import { eq } from "drizzle-orm";

const setRank = (id: number, rank: number) =>
  db.update(postings).set({ glanceRank: rank }).where(eq(postings.id, id)).run();

beforeEach(() => reset());

const boardFor = (company: string) => evalBoards().find((b) => b.company === company);

// The labels are what the human DID, not what any filter decided. That is the whole reason this
// eval can grade a filter at all — grading it against its own verdicts would be circular.
test("a posting the user applied to is a positive", () => {
  const applied = seedCandidate({ company: "Figma", title: "SWE - Data Infrastructure", state: "applied" });
  seedCandidate({ company: "Figma", title: "SWE - Traffic", state: "matched" });

  const b = boardFor("Figma")!;
  assert.equal(b.ranked.length, 2, "both postings are candidates");
  assert.deepEqual([...b.positives], [String(applied)]);
});

// Everything downstream of applying is still evidence the user wanted the role — a rejection or a
// ghosting is the company's decision, not a retraction of the user's.
test("every post-apply state counts as a positive", () => {
  for (const state of POSITIVE_STATES) {
    reset();
    seedCandidate({ company: "Acme", title: `role-${state}`, state: state as never });
    const b = boardFor("Acme")!;
    assert.equal(b.positives.size, 1, `${state} is a positive`);
  }
});

// Needs a pursued posting alongside it, or the company emits no board at all (see the next test) and
// there'd be nothing to inspect.
test("a dismissed posting sits on the board but is not a positive", () => {
  const applied = seedCandidate({ company: "Figma", title: "SWE - Data Infrastructure", state: "applied" });
  const dropped = seedCandidate({ company: "Figma", title: "SWE - Mobile Web", state: "dismissed" });

  const b = boardFor("Figma")!;
  assert.ok(b.ranked.includes(String(dropped)), "it is still a candidate to rank");
  assert.deepEqual([...b.positives], [String(applied)], "only the applied one is a positive");
});

// A company with nothing pursued can't score a ranking — there is no right answer to rank toward.
// Dropping it here keeps it out of the denominator rather than counting as a failure.
test("a company with no positives is not emitted as a board", () => {
  seedCandidate({ company: "Quiet Corp", state: "matched" });
  assert.equal(boardFor("Quiet Corp"), undefined);
});

// The board is the company's whole history, not one scan. `scanned_at` is refreshed every pass so a
// point-in-time board can't be reconstructed; the larger pool makes the score pessimistic, which is
// stated where the number is reported.
test("the board spans every posting ever seen for the company", () => {
  seedCandidate({ company: "Anthropic", title: "a", state: "applied" });
  seedCandidate({ company: "Anthropic", title: "b", state: "dismissed" });
  seedCandidate({ company: "Anthropic", title: "c", state: "filtered" });

  const b = boardFor("Anthropic")!;
  assert.equal(b.ranked.length, 3);
});

test("boards from different companies stay separate", () => {
  seedCandidate({ company: "Figma", state: "applied" });
  seedCandidate({ company: "Airbnb", state: "applied" });

  assert.equal(evalBoards().length, 2);
});

// ── scoring the RANKER, not the baseline ──────────────────────────────────────────────────────
// evalBoards() returns candidates in id order — a candidate LIST, not a ranking. Scoring that
// measures the autoincrement. The thing under test is `glance_rank`, and until it was read the eval
// re-measured the floor every time and reported it as if it were a result.
test("a board orders by the ranker's position when asked", () => {
  const a = seedCandidate({ company: "Figma", title: "third", state: "matched" });
  const b = seedCandidate({ company: "Figma", title: "first", state: "applied" });
  const c = seedCandidate({ company: "Figma", title: "second", state: "matched" });
  setRank(a, 3); setRank(b, 1); setRank(c, 2);

  const board = evalBoards({ ranked: true }).find((x) => x.company === "Figma")!;
  assert.deepEqual(board.postings.map((p) => p.title), ["first", "second", "third"]);
  assert.equal(board.ranked[0], String(b), "the ranker's #1 leads");
});

// Unranked rows sort after ranked ones — the ranker never saw them, which is not the same as
// ranking them last.
test("unranked rows follow the ranked ones", () => {
  const ranked = seedCandidate({ company: "Figma", title: "ranked", state: "applied" });
  seedCandidate({ company: "Figma", title: "unranked", state: "matched" });
  setRank(ranked, 5);

  const board = evalBoards({ ranked: true }).find((x) => x.company === "Figma")!;
  assert.deepEqual(board.postings.map((p) => p.title), ["ranked", "unranked"]);
});

// The comparison the eval exists for: the same boards, scored both ways.
test("the baseline and the ranked ordering are separately scorable", () => {
  // Ranker puts the pursued posting first; id order puts it last.
  const worst = seedCandidate({ company: "Figma", title: "a", state: "matched" });
  const mid = seedCandidate({ company: "Figma", title: "b", state: "matched" });
  const good = seedCandidate({ company: "Figma", title: "c", state: "applied" });
  setRank(worst, 3); setRank(mid, 2); setRank(good, 1);

  const base = scoreBoards(evalBoards(), [1]);
  const ranked = scoreBoards(evalBoards({ ranked: true }), [1]);
  assert.equal(base.precisionAt[1], 0, "id order buries it");
  assert.equal(ranked.precisionAt[1], 1, "the ranker surfaces it");
});

// ── what counts as agreement at the SCAN stage ────────────────────────────────────────────────
// "Added to fit" IS the human agreeing with the glance — recorded at the moment of the decision,
// over the same population as the discards. Waiting for an application instead made the label
// arrive weeks later for a handful of rows, and blamed the glance for a FIT-stage rejection.
test("adding a posting to fit counts as agreement with the glance", () => {
  seedCandidate({ company: "Figma", title: "queued for fit", state: "fit_queue" });
  seedCandidate({ company: "Figma", title: "scored", state: "assessed" });

  const b = boardFor("Figma")!;
  assert.equal(b.positives.size, 2, "both are the human saying yes at this stage");
});

// A posting dropped AFTER the full JD was read says something about the fit assessment, not about
// the glance that surfaced it. It must not come back as a scan-stage negative.
test("a discard after fit does not count against the glance", () => {
  const kept = seedCandidate({ company: "Figma", title: "kept", state: "assessed" });
  seedCandidate({ company: "Figma", title: "dropped after reading the JD", state: "dismissed" });

  const b = boardFor("Figma")!;
  assert.deepEqual([...b.positives], [String(kept)], "only the one still in the pipeline is positive");
});
