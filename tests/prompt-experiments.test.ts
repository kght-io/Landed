import { test } from "node:test";
import assert from "node:assert/strict";
import { CALLBACK_WINDOW_DAYS, callbackOutcome, fitBucket, type AppliedRow } from "@landed/shared/experiments/prompts";

// Pure — no DB, no setup import. A fixed "now" keeps the pending window deterministic.
const NOW = new Date("2026-08-12T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

const row = (over: Partial<AppliedRow> = {}): AppliedRow => ({
  postingId: 1,
  appliedAt: daysAgo(60),
  state: "applied",
  interviewed: false,
  fitScore: 70,
  fitPromptVersionId: 1,
  tailorPromptVersionId: 1,
  ...over,
});

// ── outcome classification ──────────────────────────────────────────────────────────────────

test("a rejection AFTER an interview is a callback, not a failure", () => {
  // The single most consequential ordering in this file: `state` only holds the LATEST value, so a
  // loop that ended in a no reads as "rejected". Checking rejection first would delete most of the
  // positive signal the whole comparison is built on.
  assert.equal(callbackOutcome(row({ state: "rejected", interviewed: true }), NOW), "callback");
});

test("a rejection with no interview is a no_callback, even inside the wait window", () => {
  assert.equal(callbackOutcome(row({ state: "rejected", interviewed: false, appliedAt: daysAgo(3) }), NOW), "no_callback");
});

test("a recent application is pending — not yet a negative", () => {
  assert.equal(callbackOutcome(row({ appliedAt: daysAgo(3) }), NOW), "pending");
  assert.equal(callbackOutcome(row({ appliedAt: daysAgo(CALLBACK_WINDOW_DAYS - 1) }), NOW), "pending");
});

test("silence past the wait window counts as a no", () => {
  assert.equal(callbackOutcome(row({ appliedAt: daysAgo(CALLBACK_WINDOW_DAYS + 1) }), NOW), "no_callback");
});

test("a posting you marked ghosted is a no regardless of how recent it is", () => {
  assert.equal(callbackOutcome(row({ state: "ghost", appliedAt: daysAgo(2) }), NOW), "no_callback");
});

test("withdrawn and expired are excluded — your decision, not the prompt's failure", () => {
  assert.equal(callbackOutcome(row({ state: "withdrawn" }), NOW), "excluded");
  assert.equal(callbackOutcome(row({ state: "expired" }), NOW), "excluded");
});

test("reaching an offer is a callback (the richer funnel is additive over the same rule)", () => {
  assert.equal(callbackOutcome(row({ state: "offer", interviewed: false }), NOW), "callback");
  assert.equal(callbackOutcome(row({ state: "accepted", interviewed: false }), NOW), "callback");
});

test("a bare YYYY-MM-DD applied date is read as UTC, not local", () => {
  // A local parse shifts the day and can flip a row across the window edge.
  const exactlyAtEdge = row({ appliedAt: daysAgo(CALLBACK_WINDOW_DAYS) });
  assert.equal(callbackOutcome(exactlyAtEdge, NOW), "no_callback");
  assert.equal(callbackOutcome(row({ appliedAt: null }), NOW), "excluded", "never actually applied");
});

test("fitBucket boundaries", () => {
  assert.equal(fitBucket(80), "80+");
  assert.equal(fitBucket(79), "60-79");
  assert.equal(fitBucket(60), "60-79");
  assert.equal(fitBucket(59), "40-59");
  assert.equal(fitBucket(0), "<40");
  assert.equal(fitBucket(null), "unscored");
});
