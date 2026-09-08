import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedCandidate, db, postings } from "./helpers";
import { scannedAction } from "@landed/backend/db/queries";
import { DISMISS_REASONS, isDismissReason } from "@landed/shared/jobs/dismiss";

beforeEach(() => reset());

const reasonOf = (id: number) =>
  db.select().from(postings).where(eq(postings.id, id)).get()?.dismissReason ?? null;
const stateOf = (id: number) =>
  db.select().from(postings).where(eq(postings.id, id)).get()?.state ?? null;

// The label set is the contract between the discard chips and the eval scorer. Both read it from
// `shared`, so a typo in one can't silently produce a bucket the other never counts.
test("the label set is exactly the six disqualifying reasons", () => {
  assert.deepEqual([...DISMISS_REASONS], ["role", "stack", "domain", "level", "company", "other"]);
});

test("isDismissReason accepts a member and rejects anything else", () => {
  assert.equal(isDismissReason("role"), true);
  assert.equal(isDismissReason("other"), true);
  // `better-option` was deliberately NOT added — the grouped view handles that case by letting you
  // skip a row instead of discarding it, so those roles never enter the dataset as negatives.
  assert.equal(isDismissReason("better-option"), false);
  assert.equal(isDismissReason(""), false);
  assert.equal(isDismissReason(undefined), false);
});

test("discard with a reason records it alongside the dismissal", () => {
  const id = seedCandidate({ company: "Figma", title: "Software Engineer - Mobile Web", state: "matched" });
  const r = scannedAction(id, "discard", { reason: "role" });
  assert.equal(r.ok, true);
  assert.equal(stateOf(id), "dismissed");
  assert.equal(reasonOf(id), "role");
});

// Back-compat: every existing caller passes no reason, and the 447 historical dismissals stay
// unlabeled. A discard must never require a label to succeed.
test("discard without a reason still works and leaves the label null", () => {
  const id = seedCandidate({ company: "Figma", state: "matched" });
  const r = scannedAction(id, "discard");
  assert.equal(r.ok, true);
  assert.equal(stateOf(id), "dismissed");
  assert.equal(reasonOf(id), null);
});

// The DB layer is the last line of defence: the route validates too, but a bad value reaching here
// would poison the label set the scorer groups by.
test("an unrecognized reason is not persisted", () => {
  const id = seedCandidate({ company: "Figma", state: "matched" });
  scannedAction(id, "discard", { reason: "vibes" as never });
  assert.equal(stateOf(id), "dismissed");
  assert.equal(reasonOf(id), null);
});

// Re-discarding with a new reason should correct the label, not keep the first answer.
test("discarding again overwrites the previous reason", () => {
  const id = seedCandidate({ company: "Figma", state: "matched" });
  scannedAction(id, "discard", { reason: "role" });
  scannedAction(id, "discard", { reason: "domain" });
  assert.equal(reasonOf(id), "domain");
});

// Only `discard` carries a reason — a queue-fit that happens to be handed one must ignore it rather
// than stamp a dismissal label on a posting that was kept.
test("queue-fit ignores a reason", () => {
  const id = seedCandidate({ company: "Figma", state: "matched" });
  scannedAction(id, "queue-fit", { reason: "role" } as never);
  assert.equal(stateOf(id), "fit_queue");
  assert.equal(reasonOf(id), null);
});

// ── reverting a discard ───────────────────────────────────────────────────────────────────────
// A mis-clicked chip is a wrong LABEL, not just a wrong pile. If reverting leaves the reason behind,
// that mistake stays a negative in the eval set forever — silently poisoning the dataset the whole
// filter is scored against. Undo has to undo both.
test("reverting a discard clears the label as well as the state", () => {
  const id = seedCandidate({ company: "Airbnb", title: "Staff SWE, Build (Bazel)", state: "matched" });
  scannedAction(id, "discard", { reason: "level" });
  assert.equal(reasonOf(id), "level");

  scannedAction(id, "revert");
  assert.equal(stateOf(id), "matched", "back in the triage pile, not the fit queue");
  assert.equal(reasonOf(id), null, "the label is gone, not just the pile");
});

// Any path OUT of dismissed must clear it, not just the revert action — otherwise the label survives
// through a queue-fit and lands in the dataset attached to a posting you actually pursued.
test("queueing a discarded posting for fit also clears the label", () => {
  const id = seedCandidate({ company: "Airbnb", title: "x", state: "matched" });
  scannedAction(id, "discard", { reason: "role" });
  scannedAction(id, "queue-fit");
  assert.equal(stateOf(id), "fit_queue");
  assert.equal(reasonOf(id), null);
});

test("reverting something that was never discarded is a no-op, not an error", () => {
  const id = seedCandidate({ company: "Airbnb", title: "y", state: "fit_queue" });
  const r = scannedAction(id, "revert");
  assert.equal(r.ok, true);
  assert.equal(stateOf(id), "matched");
});
