import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { precisionAtK, reciprocalRank, scoreBoards, splitByCompany, type RankedBoard } from "@landed/shared/experiments/ranking";

// A board = one company's postings in the order the ranker put them, plus which of them the human
// actually pursued. Precision@k asks "did the ranker put a pursued posting in the top k".
const board = (company: string, order: string[], positives: string[]): RankedBoard => ({
  company,
  ranked: order,
  positives: new Set(positives),
});

test("precision@k is 1 when a positive is inside the window, 0 when it isn't", () => {
  const b = board("Figma", ["a", "b", "c", "d"], ["c"]);
  assert.equal(precisionAtK(b, 1), 0);
  assert.equal(precisionAtK(b, 3), 1);
});

// The failure this guards against is real: 90 of 132 boards in the live DB hold ONE posting, and
// scoring them made the unranked baseline read 0.84 precision@1 — a number with no room to improve,
// mostly measuring "this company had one job".
test("a board no bigger than k is unscorable at k — the window is the whole board", () => {
  const b = board("Tiny", ["only"], ["only"]);
  assert.equal(precisionAtK(b, 1), null);
  assert.equal(precisionAtK(b, 3), null);
  assert.equal(reciprocalRank(b), null, "its only possible rank is 1");

  const four = board("Figma", ["a", "b", "c", "d"], ["c"]);
  assert.equal(precisionAtK(four, 4), null, "top-4 of a 4-board discriminates nothing");
  assert.equal(precisionAtK(four, 10), null);
});

// A board with several positives still scores 1 if ANY of them made the window. The question is
// "would the top k have been enough", not "did it rank every good role".
test("precision@k needs only one positive in the window", () => {
  const b = board("Anthropic", ["a", "b", "c"], ["b", "c"]);
  assert.equal(precisionAtK(b, 1), 0);
  assert.equal(precisionAtK(b, 2), 1);
});

test("reciprocal rank is 1/position of the first positive", () => {
  assert.equal(reciprocalRank(board("A", ["x", "y", "z"], ["x"])), 1);
  assert.equal(reciprocalRank(board("A", ["x", "y", "z"], ["y"])), 0.5);
  assert.equal(reciprocalRank(board("A", ["x", "y", "z"], ["z"])), 1 / 3);
});

// A board whose positive the ranker never emitted at all can't be scored as a ranking failure —
// something upstream dropped it. Counting it as rank-∞ would blame the ranker for a filter's miss.
test("a board with no positive in the ranking is excluded, not scored zero", () => {
  const b = board("A", ["x", "y", "z", "w"], ["gone"]);
  assert.equal(reciprocalRank(b), null);
  assert.equal(precisionAtK(b, 3), null);
});

test("scoreBoards averages only the scorable boards and reports the exclusions", () => {
  const boards = [
    board("A", ["1", "2", "3"], ["1"]), // rank 1
    board("B", ["1", "2", "3"], ["3"]), // rank 3
    board("C", ["1", "2"], ["missing"]), // unscorable
  ];
  const r = scoreBoards(boards, [1, 3]);
  assert.equal(r.boards, 2, "only scorable boards count");
  assert.equal(r.excluded, 1);
  assert.equal(r.precisionAt[1], 0.5); // A yes, B no
  assert.equal(r.scoredAt[1], 2);
  // @3 over 3-posting boards is the whole board — nothing to discriminate, so nobody contributes.
  assert.equal(r.precisionAt[3], null);
  assert.equal(r.scoredAt[3], 0);
  assert.equal(r.mrr, (1 + 1 / 3) / 2);
});

// Each k has its own population: a 5-posting board informs @1 and @3 but not @10. Averaging them as
// if they were one set is how a metric quietly stops meaning anything.
test("the scorable board count is reported per k", () => {
  const boards = [
    board("small", ["1", "2", "3", "4", "5"], ["2"]),
    board("big", Array.from({ length: 20 }, (_, i) => String(i)), ["7"]),
  ];
  const r = scoreBoards(boards, [1, 3, 10]);
  assert.equal(r.scoredAt[1], 2);
  assert.equal(r.scoredAt[3], 2);
  assert.equal(r.scoredAt[10], 1, "only the 20-posting board can inform @10");
});

test("scoring an empty set reports zero boards rather than dividing by zero", () => {
  const r = scoreBoards([], [1, 3]);
  assert.equal(r.boards, 0);
  assert.equal(r.mrr, null);
  assert.equal(r.precisionAt[3], null);
  assert.equal(r.scoredAt[3], 0);
});

// The split is BY COMPANY. Anthropic alone has ~90 postings; splitting by row would put near
// duplicates of the same board on both sides and leak dev into test.
test("splitByCompany keeps every posting of a company on one side", () => {
  const boards = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((c) => board(c, ["1"], ["1"]));
  const { dev, test: held } = splitByCompany(boards, 0.7);
  assert.equal(dev.length + held.length, 10);
  const devNames = new Set(dev.map((b) => b.company));
  assert.ok(held.every((b) => !devNames.has(b.company)), "no company appears on both sides");
});

test("the split is deterministic — the same input yields the same partition", () => {
  const boards = ["a", "b", "c", "d", "e", "f", "g"].map((c) => board(c, ["1"], ["1"]));
  const one = splitByCompany(boards, 0.7).dev.map((b) => b.company);
  const two = splitByCompany(boards, 0.7).dev.map((b) => b.company);
  assert.deepEqual(one, two);
});

// A split that leaves nothing to hold out is a silent failure — you'd tune and "validate" on the
// same rows without noticing.
test("the split always holds at least one company back when there's more than one", () => {
  const boards = ["a", "b"].map((c) => board(c, ["1"], ["1"]));
  const { dev, test: held } = splitByCompany(boards, 0.95);
  assert.ok(held.length >= 1, "something is held out");
  assert.ok(dev.length >= 1, "something is left to tune on");
});
