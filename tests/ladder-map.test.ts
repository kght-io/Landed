import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SENIORITY_BANDS, bandsForTitle, coerceLadderMap, hasLadderMap, type LadderMap } from "@landed/shared/config/ladder";
import { reset, db, companies } from "./helpers";
import { upsertCompanies } from "@landed/backend/db/queries";

const companyRow = (name: string) => db.select().from(companies).all().find((c) => c.name === name);

const amazon: LadderMap = {
  rungs: [
    { rung: "L5", titles: ["Software Development Engineer II", "SDE II"], bands: ["mid"] },
    { rung: "L6", titles: ["Senior Software Development Engineer", "Senior SDE"], bands: ["senior"] },
    { rung: "L7", titles: ["Principal Engineer"], bands: ["principal"] },
  ],
  source: "model+search",
  reason: "levels.fyi and Amazon's own postings agree: L6 is Senior SDE, L7 is Principal.",
  checkedAt: "2026-08-22T00:00:00.000Z",
};

// An unlevelled title is the whole reason this exists: "Member of Technical Staff" carries no
// seniority word, so the substring gate dropped it no matter how senior the rung actually was.
const anthropic: LadderMap = {
  rungs: [
    { rung: "MTS", titles: ["Member of Technical Staff", "Software Engineer"], bands: ["senior", "staff"] },
    { rung: "Senior MTS", titles: ["Senior Software Engineer", "Staff Software Engineer"], bands: ["staff"] },
  ],
  source: "model+search",
  reason: "Anthropic posts most IC roles unlevelled; sources disagree whether plain MTS is senior or staff.",
  checkedAt: "2026-08-22T00:00:00.000Z",
};

test("a title matching a rung resolves to that rung's bands", () => {
  assert.deepEqual(bandsForTitle("Senior Software Development Engineer", amazon), ["senior"]);
  assert.deepEqual(bandsForTitle("Principal Engineer", amazon), ["principal"]);
});

test("matching is case- and whitespace-insensitive", () => {
  assert.deepEqual(bandsForTitle("  senior SDE  ", amazon), ["senior"]);
});

// Real postings decorate the title: "Senior Software Development Engineer, Sponsored Products".
// Requiring an exact match would resolve almost nothing.
test("a decorated title still matches its rung", () => {
  assert.deepEqual(bandsForTitle("Senior Software Development Engineer, Ads Platform", amazon), ["senior"]);
  assert.deepEqual(bandsForTitle("Member of Technical Staff, Inference", anthropic), ["senior", "staff"]);
});

// The recall rule, encoded: an ambiguous rung returns BOTH bands rather than picking one. 2b keeps
// anything whose band set intersects the target, so ambiguity widens and never drops.
test("an ambiguous rung returns every band it might be", () => {
  const bands = bandsForTitle("Member of Technical Staff", anthropic);
  assert.deepEqual(bands, ["senior", "staff"]);
  assert.ok(bands.length > 1, "ambiguity is preserved, not resolved");
});

// The longest matching title wins: "Senior Software Engineer" must not resolve via the shorter
// "Software Engineer" entry on a different rung.
test("the most specific matching title wins", () => {
  assert.deepEqual(bandsForTitle("Senior Software Engineer", anthropic), ["staff"]);
});

// An unmatched title is null, NOT an empty band list. Null means "this map can't say", which 2b
// must treat as keep; an empty list would read as "no band matches" and invite a drop.
test("a title the map cannot place returns null, not an empty list", () => {
  assert.equal(bandsForTitle("Chief Happiness Officer", amazon), null);
});

test("hasLadderMap rejects an empty or absent map", () => {
  assert.equal(hasLadderMap(amazon), true);
  assert.equal(hasLadderMap(null), false);
  assert.equal(hasLadderMap({ ...amazon, rungs: [] }), false);
});

// The map arrives from an agent as `unknown`. A half-readable map beats a rejected one, but a rung
// with no usable band is worse than absent — 2b would read it as a confident "not your level".
test("coerceLadderMap keeps readable rungs and drops unusable ones", () => {
  const m = coerceLadderMap({
    rungs: [
      { rung: "L6", titles: ["Senior SDE"], bands: ["senior"] },
      { rung: "L7", titles: ["Principal"], bands: ["not-a-band"] }, // no valid band → dropped
      { rung: "L8", titles: [], bands: ["principal"] }, // no titles → nothing to match on
      { titles: ["x"], bands: ["senior"] }, // no rung name
    ],
    source: "model",
    reason: "recalled",
    checkedAt: "2026-08-22T00:00:00.000Z",
  });
  assert.ok(m);
  assert.equal(m!.rungs.length, 1);
  assert.equal(m!.rungs[0].rung, "L6");
});

test("coerceLadderMap returns null when nothing survives", () => {
  assert.equal(coerceLadderMap({ rungs: [] }), null);
  assert.equal(coerceLadderMap(null), null);
  assert.equal(coerceLadderMap("nonsense"), null);
});

// The reason is the audit trail — there is no ground truth behind a mapping, so a map that can't
// say why it believes itself is not worth storing.
test("coerceLadderMap requires a reason", () => {
  assert.equal(coerceLadderMap({ rungs: [{ rung: "L6", titles: ["Senior SDE"], bands: ["senior"] }], source: "model" }), null);
});

test("the band vocabulary is ordered junior → distinguished", () => {
  assert.deepEqual([...SENIORITY_BANDS], ["junior", "mid", "senior", "staff", "principal", "distinguished"]);
});

// ── storage round-trip ────────────────────────────────────────────────────────────────────────
// The map reaches the DB through upsertCompanies, straight off an agent result, so the coercion has
// to hold at the write boundary and not only in the pure helper.
test("upsertCompanies stores a readable map and reads back the same rungs", () => {
  reset();
  upsertCompanies([{ name: "Amazon", ladderMap: amazon }]);
  const stored = coerceLadderMap(JSON.parse(companyRow("Amazon")!.ladderMap!));
  assert.equal(stored!.rungs.length, 3);
  assert.deepEqual(bandsForTitle("Senior SDE, Ads", stored!), ["senior"]);
});

// A map with nothing usable must CLEAR the column, not half-write. A degraded map is worse than an
// absent one: the gate reads it as a real answer and drops postings on nonsense.
test("upsertCompanies refuses a map with no usable rungs", () => {
  reset();
  upsertCompanies([{ name: "Amazon", ladderMap: { rungs: [{ rung: "L6" }], reason: "guessed" } }]);
  assert.equal(companyRow("Amazon")!.ladderMap, null);
});

test("upsertCompanies leaves an existing map alone when the field is omitted", () => {
  reset();
  upsertCompanies([{ name: "Amazon", ladderMap: amazon }]);
  upsertCompanies([{ name: "Amazon", tier: "tier1" }]);
  assert.ok(companyRow("Amazon")!.ladderMap, "an unrelated patch doesn't clobber it");
});

test("passing null clears the map", () => {
  reset();
  upsertCompanies([{ name: "Amazon", ladderMap: amazon }]);
  upsertCompanies([{ name: "Amazon", ladderMap: null }]);
  assert.equal(companyRow("Amazon")!.ladderMap, null);
});
