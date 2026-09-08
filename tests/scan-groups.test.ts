import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByCompany, funnelStageOf, FUNNEL_STAGES } from "@landed/shared/pipeline/scan-funnel";
import { reset, seedCandidate, db, postings } from "./helpers";
import { scanFunnel } from "@landed/backend/db/pipeline-metrics";
import { eq } from "drizzle-orm";

// Set the stage-2 columns directly — applyGlance is exercised in glance-rank.test.ts; here we only
// need rows in a given shape.
const setGlanceFields = (id: number, f: { bands?: string[]; rank?: number }) =>
  db.update(postings)
    .set({ glanceBands: f.bands ? JSON.stringify(f.bands) : null, glanceRank: f.rank ?? null })
    .where(eq(postings.id, id))
    .run();

const row = (company: string, title: string, rank: number | null = null, scannedAt = "2026-08-20T00:00:00Z") => ({
  company,
  title,
  glanceRank: rank,
  scannedAt,
});

// ── grouping ──────────────────────────────────────────────────────────────────────────────────
test("rows are grouped by company", () => {
  const gs = groupByCompany([row("Figma", "a"), row("Airbnb", "b"), row("Figma", "c")]);
  assert.equal(gs.length, 2);
  assert.deepEqual(gs.map((g) => g.rows.length).sort(), [1, 2]);
});

// The rank is the whole point of 2c — a group that ignored it would leave the grouped view no better
// than the flat list it replaced.
test("within a group, rows sort by rank ascending", () => {
  const g = groupByCompany([row("Figma", "third", 3), row("Figma", "first", 1), row("Figma", "second", 2)])[0];
  assert.deepEqual(g.rows.map((r) => r.title), ["first", "second", "third"]);
});

// Unranked is not "ranked last" — it means the ranker never saw this row (it predates 2c, or the
// agent omitted a number). Sorting them last keeps them visible without pretending they lost.
test("unranked rows sort after ranked ones, not interleaved", () => {
  const g = groupByCompany([row("Figma", "none", null), row("Figma", "two", 2), row("Figma", "one", 1)])[0];
  assert.deepEqual(g.rows.map((r) => r.title), ["one", "two", "none"]);
});

test("unranked rows fall back to newest-scanned first", () => {
  const g = groupByCompany([
    row("Figma", "older", null, "2026-08-01T00:00:00Z"),
    row("Figma", "newer", null, "2026-08-20T00:00:00Z"),
  ])[0];
  assert.deepEqual(g.rows.map((r) => r.title), ["newer", "older"]);
});

// The header answers "is this company worth opening" without expanding it.
test("a group reports its size and its top row", () => {
  const g = groupByCompany([row("Figma", "second", 2), row("Figma", "best", 1)])[0];
  assert.equal(g.count, 2);
  assert.equal(g.top, "best");
});

test("a group of only unranked rows still reports a top row", () => {
  const g = groupByCompany([row("Figma", "only", null)])[0];
  assert.equal(g.top, "only");
});

// Groups themselves keep the flat list's ordering rule — most recently scanned first — so the tab
// doesn't silently reshuffle under someone used to it.
test("groups are ordered by their most recent scan", () => {
  const gs = groupByCompany([
    row("Old Corp", "x", null, "2026-08-01T00:00:00Z"),
    row("New Corp", "y", null, "2026-08-20T00:00:00Z"),
  ]);
  assert.deepEqual(gs.map((g) => g.company), ["New Corp", "Old Corp"]);
});

test("grouping an empty list yields no groups", () => {
  assert.deepEqual(groupByCompany([]), []);
});

// ── the funnel ────────────────────────────────────────────────────────────────────────────────
// `reason` already records WHICH gate dropped a row, and each reason belongs to exactly one stage —
// so the funnel needs no new column to attribute a drop.
test("each drop reason maps to the stage that made it", () => {
  assert.equal(funnelStageOf("excluded"), "mechanical");
  assert.equal(funnelStageOf("location"), "mechanical");
  assert.equal(funnelStageOf("dedup"), "mechanical");
  assert.equal(funnelStageOf("cooldown"), "mechanical");
});

// These two reasons are retired — stage 1 no longer produces them — but rows carrying them are still
// in the table from before the change. They must still attribute, or historical rows vanish from the
// funnel and it silently under-reports.
test("retired reasons still attribute to the stage that made them", () => {
  assert.equal(funnelStageOf("level"), "mechanical");
  assert.equal(funnelStageOf("unmatched"), "mechanical");
});

test("an unrecognized reason attributes to nothing rather than guessing", () => {
  assert.equal(funnelStageOf("who knows"), null);
  assert.equal(funnelStageOf(null), null);
});

test("the funnel stages read in pipeline order", () => {
  assert.deepEqual([...FUNNEL_STAGES], ["mechanical", "glance", "you", "fit", "applied"]);
});

// ── the funnel, over real rows ────────────────────────────────────────────────────────────────
test("the funnel counts where postings died", () => {
  reset();
  seedCandidate({ company: "Acme", title: "Sales Engineer", state: "filtered", verdict: "dropped", reason: "excluded" });
  seedCandidate({ company: "Acme", title: "Staff SWE", state: "matched" });
  seedCandidate({ company: "Acme", title: "Senior SWE", state: "fit_queue" });
  seedCandidate({ company: "Acme", title: "Backend SWE", state: "applied" });
  // A real hand-discard carries its chip label — that marker is what separates it from the agent's
  // glance drop, which writes the same `dismissed` state.
  const mine = seedCandidate({ company: "Acme", title: "Mobile SWE", state: "dismissed" });
  db.update(postings).set({ dismissReason: "role" }).where(eq(postings.id, mine)).run();

  const f = scanFunnel();
  assert.equal(f.fetched, 5, "everything the scan filed");
  assert.equal(f.mechanical, 1, "dropped by the regex gates");
  assert.equal(f.you, 1, "you discarded it");
  assert.equal(f.applied, 1);
});

// Retired reasons must keep counting, or the funnel silently under-reports its own history.
test("rows carrying a retired reason still count as mechanical drops", () => {
  reset();
  seedCandidate({ company: "Acme", title: "old", state: "filtered", verdict: "dropped", reason: "level" });
  assert.equal(scanFunnel().mechanical, 1);
});

// "Widened" is the recall rule made visible: the gate saw an ambiguous ladder and refused to guess.
// A gate that silently declined to drop can't be told from one that never looked.
test("the funnel counts how often the level call widened rather than dropped", () => {
  reset();
  const a = seedCandidate({ company: "Acme", title: "MTS", state: "matched" });
  const b = seedCandidate({ company: "Acme", title: "Staff SWE", state: "matched" });
  setGlanceFields(a, { bands: ["senior", "staff"] });
  setGlanceFields(b, { bands: ["staff"] });

  const f = scanFunnel();
  assert.equal(f.widened, 1, "only the ambiguous one counts");
  assert.equal(f.levelled, 2, "both got a level call");
});

// ── who dropped it ────────────────────────────────────────────────────────────────────────────
// `applyGlance` files an agent drop as `dismissed` — the same state YOUR discard writes. Splitting
// the funnel on state alone therefore credited every agent drop to you: 752 of them showed up as
// hand-discards next to your actual 23. That's the number that says whether the pipeline is doing
// its job, so being 30× out made it worse than absent.
//
// The rows already distinguish themselves: your discard sets `dismiss_reason` (the chip), the
// agent's sets `reason` (prose).
test("an agent glance drop is not counted as a hand-discard", () => {
  reset();
  const a = seedCandidate({ company: "Acme", title: "ML Engineer", state: "dismissed" });
  db.update(postings).set({ reason: "Machine Learning — an excluded discipline" }).where(eq(postings.id, a)).run();

  const f = scanFunnel();
  assert.equal(f.glance, 1, "the agent's drop is attributed to the glance");
  assert.equal(f.you, 0, "and not to you");
});

test("your labelled discard is counted as yours", () => {
  reset();
  const a = seedCandidate({ company: "Acme", title: "iOS Engineer", state: "dismissed" });
  db.update(postings).set({ dismissReason: "role" }).where(eq(postings.id, a)).run();

  const f = scanFunnel();
  assert.equal(f.you, 1);
  assert.equal(f.glance, 0);
});

// A row the mechanical filter dropped that you LATER discarded carries both markers. Your action is
// the later and more specific fact, so it wins.
test("when both markers are present, yours wins", () => {
  reset();
  const a = seedCandidate({ company: "Acme", title: "x", state: "dismissed", reason: "excluded" });
  db.update(postings).set({ dismissReason: "company" }).where(eq(postings.id, a)).run();

  assert.equal(scanFunnel().you, 1);
  assert.equal(scanFunnel().glance, 0);
});

// Everything discarded before either marker existed. It can't be attributed, and guessing would
// quietly inflate whichever bucket got the benefit of the doubt.
test("an unmarked dismissal is reported separately, not assigned to someone", () => {
  reset();
  seedCandidate({ company: "Acme", title: "old", state: "dismissed" });

  const f = scanFunnel();
  assert.equal(f.unattributed, 1);
  assert.equal(f.you, 0);
  assert.equal(f.glance, 0);
});
