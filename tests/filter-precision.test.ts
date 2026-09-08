import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, seedCandidate, db } from "./helpers";
import { postings } from "@landed/backend/db/schema";
import { filterPrecision } from "@landed/backend/db/pipeline-metrics";
import { setProfile } from "@landed/backend/db/profile";
import { eq } from "drizzle-orm";

beforeEach(() => reset());

// seedCandidate stamps an old scannedAt, so every fixture is dated into the window under test
// unless it says otherwise.
const decide = (id: number, opts: { reason?: string; scannedAt?: string } = {}) =>
  db.update(postings)
    .set({ scannedAt: opts.scannedAt ?? RECENT, ...(opts.reason ? { dismissReason: opts.reason } : {}) })
    .where(eq(postings.id, id))
    .run();

const RECENT = "2026-09-05T00:00:00.000Z";
const OLD = "2026-08-01T00:00:00.000Z";

// Of what the filter SURFACED, how much did the human want? Both labels exist over the same
// population, decided at the same moment — which is what makes this a real score, unlike recall
// (a dropped posting leaves no trace of whether it was wanted).
test("precision is agreed / (agreed + discarded)", () => {
  for (let i = 0; i < 3; i++) decide(seedCandidate({ company: "Figma", title: `yes${i}`, state: "fit_queue" }));
  const no = seedCandidate({ company: "Figma", title: "no", state: "dismissed" });
  decide(no, { reason: "role" });

  const r = filterPrecision({ since: OLD, minDecided: 1 });
  assert.equal(r.agreed, 3);
  assert.equal(r.discarded, 1);
  assert.equal(r.precision, 0.75);
});

// The filter changed. Scoring today's filter against decisions made about a DIFFERENT filter's
// output measures nothing — most of the 294 historical agreements predate the level/discipline
// changes entirely, and counting them would have made the score look settled when it isn't.
test("only postings the current filter surfaced are counted", () => {
  const old = seedCandidate({ company: "Figma", title: "old", state: "fit_queue" });
  decide(old, { scannedAt: OLD });
  const recent = seedCandidate({ company: "Figma", title: "recent", state: "fit_queue" });
  decide(recent, { scannedAt: RECENT });

  assert.equal(filterPrecision({ since: "2026-09-04", minDecided: 1 }).agreed, 1);
});

// Undecided rows are not evidence either way. Counting them as failures would punish the filter for
// a pile the human simply hasn't got to.
test("undecided postings are excluded, and reported separately", () => {
  decide(seedCandidate({ company: "Figma", title: "waiting", state: "matched" }));
  const yes = seedCandidate({ company: "Figma", title: "yes", state: "fit_queue" });
  decide(yes);

  const r = filterPrecision({ since: OLD, minDecided: 1 });
  assert.equal(r.agreed, 1);
  assert.equal(r.undecided, 1);
  assert.equal(r.precision, 1);
});

// A rate over a handful is noise wearing a number — the same bar experiments/prompts.ts sets with
// MIN_DECIDED_FOR_RATE. The count is always reported; the RATE is withheld until it means something.
test("the rate is withheld below the decision floor", () => {
  const yes = seedCandidate({ company: "Figma", title: "yes", state: "fit_queue" });
  decide(yes);

  const r = filterPrecision({ since: OLD, minDecided: 10 });
  assert.equal(r.precision, null, "no number until there's enough to read");
  assert.equal(r.decided, 1, "but the progress toward it is visible");
});

// Which reasons the filter is failing on is more actionable than the rate: `role` dominating says
// the discipline call is the weak point, `level` says the ladder is.
test("discards break down by reason", () => {
  const a = seedCandidate({ company: "Figma", title: "a", state: "dismissed" });
  const b = seedCandidate({ company: "Figma", title: "b", state: "dismissed" });
  const c = seedCandidate({ company: "Figma", title: "c", state: "dismissed" });
  decide(a, { reason: "role" }); decide(b, { reason: "role" }); decide(c, { reason: "level" });

  const r = filterPrecision({ since: OLD, minDecided: 1 });
  assert.deepEqual(r.byReason, { role: 2, level: 1 });
});

test("no decisions at all is reported, not divided by zero", () => {
  const r = filterPrecision({ since: OLD, minDecided: 1 });
  assert.equal(r.decided, 0);
  assert.equal(r.precision, null);
});

// ── the preference era ────────────────────────────────────────────────────────────────────────
// A hardcoded `since` was the first version of this, and it rots: it has to be bumped by hand every
// time the filter or the preferences move, and if it isn't, the score silently mixes eras. Scoping
// to the preference era makes drift move the boundary on its own.
test("changing a preference re-scopes the score to the new era", () => {
  const old = seedCandidate({ company: "Figma", title: "judged under the old prefs", state: "fit_queue" });
  decide(old, { scannedAt: "2026-09-05T00:00:00.000Z" });
  assert.equal(filterPrecision({ minDecided: 1 }).agreed, 1);

  // You now target a different level. Everything decided before this said something about a
  // preference you no longer hold.
  setProfile({ levelRule: "Staff at big cos now" });

  const after = filterPrecision({ minDecided: 1 });
  assert.equal(after.agreed, 0, "the old era's decisions are out of scope");
  assert.equal(after.decided, 0);
});

// Two boundaries, and BOTH have to hold: the preference era, and the day the pipeline itself
// changed. An unedited profile doesn't unlock decisions made by a filter that no longer exists.
test("the pipeline-change floor applies even with no preference edits", () => {
  const stale = seedCandidate({ company: "Figma", title: "pre-pipeline", state: "fit_queue" });
  decide(stale, { scannedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(filterPrecision({ minDecided: 1 }).decided, 0, "older than the pipeline change");

  const current = seedCandidate({ company: "Figma", title: "post-pipeline", state: "fit_queue" });
  decide(current, { scannedAt: "2026-09-05T00:00:00.000Z" });
  assert.equal(filterPrecision({ minDecided: 1 }).agreed, 1);
});
