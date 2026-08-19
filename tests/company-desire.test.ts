import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, seedApp, db, companies } from "./helpers";
import { listCompanies, listPostings, upsertCompanies } from "@landed/backend/db/queries";
import { aggregateCompanies } from "@landed/shared/pipeline/board";
import { coerceDesire, DESIRE_VALUES, DESIRE_META } from "@landed/shared/config/desire";

beforeEach(() => reset());

const desireOf = (name: string): number | null =>
  listCompanies().find((c) => c.name === name)?.desire ?? null;

// ── the scale itself ────────────────────────────────────────────────────────────────────────
test("every rung on the 1–5 scale has a label", () => {
  assert.deepEqual(DESIRE_VALUES, [5, 4, 3, 2, 1]); // best first — how a picker should read
  for (const d of DESIRE_VALUES) assert.ok(DESIRE_META[d].label.length > 0);
});

test("coerceDesire takes what a human or an agent actually sends", () => {
  assert.equal(coerceDesire(4), 4);
  assert.equal(coerceDesire("5"), 5);   // a <select> hands back strings
  assert.equal(coerceDesire(2.6), 3);   // rounded, not floored
});

test("coerceDesire clamps out-of-range instead of dropping the tag", () => {
  assert.equal(coerceDesire(9), 5);
  assert.equal(coerceDesire(0), 1);
  assert.equal(coerceDesire(-3), 1);
});

test("untaggable input is untagged, never a bogus number", () => {
  for (const v of [null, undefined, "", "  ", "high", NaN, {}, true, []])
    assert.equal(coerceDesire(v), null, `${JSON.stringify(v)} should be untagged`);
});

// ── persistence: it's a company-level tag ───────────────────────────────────────────────────
test("a company carries its desire tag", () => {
  upsertCompanies([{ name: "Anthropic", desire: 5 }]);
  assert.equal(desireOf("Anthropic"), 5);
});

test("an untagged company reads as null, not 0", () => {
  upsertCompanies([{ name: "Rokt" }]);
  assert.equal(desireOf("Rokt"), null);
});

test("a later upsert that omits desire leaves the tag alone", () => {
  upsertCompanies([{ name: "Oscar Health", desire: 4 }]);
  upsertCompanies([{ name: "Oscar Health", ats: "greenhouse" }]);
  assert.equal(desireOf("Oscar Health"), 4);
});

test("desire: null clears the tag", () => {
  upsertCompanies([{ name: "Vercel", desire: 3 }]);
  upsertCompanies([{ name: "Vercel", desire: null }]);
  assert.equal(desireOf("Vercel"), null);
});

test("a garbage value from the agent never lands in the column", () => {
  upsertCompanies([{ name: "Gusto", desire: 11 as never }]);
  assert.equal(desireOf("Gusto"), 5);
  upsertCompanies([{ name: "Gusto", desire: "nope" as never }]);
  assert.equal(desireOf("Gusto"), null);
});

test("desire is independent of tier — they answer different questions", () => {
  upsertCompanies([{ name: "Metropolis", tier: "tier3", desire: 5 }]);
  const c = db.select().from(companies).all().find((x) => x.name === "Metropolis")!;
  assert.equal(c.tier, "tier3");
  assert.equal(c.desire, 5);
});

test("changing the tag is audited like any other curation edit", () => {
  upsertCompanies([{ name: "Axon", desire: 2 }]);
  upsertCompanies([{ name: "Axon", desire: 5 }], { actor: "You", source: "ui" });
  assert.equal(desireOf("Axon"), 5);
});

// ── the tag has to reach the surfaces you actually rate companies from ──────────────────────
// The watchlist table only lists companies you auto-scan; the ones you're deepest with (an active
// loop) may not be on it. So the tag rides along on the posting, like tier/watchlist already do,
// and the pipeline's company drawer can edit it.
test("a posting carries its company's desire tag", () => {
  seedApp({ company: "Axon", status: "interview" });
  upsertCompanies([{ name: "Axon", desire: 4 }]);
  assert.equal(listPostings().find((p) => p.company === "Axon")?.desire, 4);
});

test("an untagged company's postings say so", () => {
  seedApp({ company: "Ramp", status: "applied" });
  assert.equal(listPostings().find((p) => p.company === "Ramp")?.desire, null);
});

test("the company rollup carries the tag", () => {
  seedApp({ company: "Oscar Health", status: "interview" });
  seedApp({ company: "Oscar Health", role: "Staff SWE, Platform", status: "applied" });
  upsertCompanies([{ name: "Oscar Health", desire: 5 }]);
  const agg = aggregateCompanies(listPostings()).find((c) => c.company === "Oscar Health")!;
  assert.equal(agg.desire, 5);
  assert.equal(agg.items.length, 2); // one tag for the company, however many postings it has
});
