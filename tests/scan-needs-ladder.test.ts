import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, db, companies } from "./helpers";
import { queueStaleWatchlistScans, queueWatchlistScan } from "@landed/backend/jobs/store";
import { listJobs } from "@landed/backend/jobs/queue";
import { sweepQueue } from "@landed/backend/jobs/sweep";
import { upsertCompanies } from "@landed/backend/db/queries";
import { setCompanyCooldown } from "@landed/backend/db/cooldown";
import { eq } from "drizzle-orm";

beforeEach(() => reset());

const seedCo = (name: string, watchlist = true) =>
  db.insert(companies).values({ name, tier: "tier1", watchlist }).returning({ id: companies.id }).get().id;

const goodMap = {
  rungs: [{ rung: "L6", titles: ["Senior Software Engineer"], bands: ["senior"] }],
  source: "model+search",
  reason: "levels.fyi and the company's postings agree",
};

const typesQueued = () => listJobs().map((j) => j.type).sort();

// The dependency is DATA, not scheduling: the level gate reads companies.ladder_map, and the queue
// has no dependsOn. So the precondition has to live here — otherwise a scan runs first, the gate has
// nothing to judge against, and the whole board arrives unlevelled with no sign anything was missing.
test("an unmapped company is mapped instead of scanned", () => {
  seedCo("Airbnb");
  const r = queueStaleWatchlistScans();

  assert.deepEqual(typesQueued(), ["leveling-map"], "the map is queued, the scan is not");
  assert.equal(r.mapping, 1);
  assert.equal(r.queued, 0);
});

test("a mapped company is scanned", () => {
  seedCo("Amazon");
  upsertCompanies([{ name: "Amazon", ladderMap: goodMap }]);

  const r = queueStaleWatchlistScans();
  assert.deepEqual(typesQueued(), ["watchlist-scan"]);
  assert.equal(r.queued, 1);
  assert.equal(r.mapping, 0);
});

// One click has to get you all the way there: the first sweep maps, the second scans.
test("the second sweep scans what the first one mapped", () => {
  seedCo("Airbnb");
  queueStaleWatchlistScans();
  upsertCompanies([{ name: "Airbnb", ladderMap: goodMap }]); // the agent completes the map

  queueStaleWatchlistScans();
  assert.ok(typesQueued().includes("watchlist-scan"), "now it scans");
});

test("a mixed watchlist maps some and scans others in one pass", () => {
  seedCo("Airbnb");
  seedCo("Amazon");
  upsertCompanies([{ name: "Amazon", ladderMap: goodMap }]);

  const r = queueStaleWatchlistScans();
  assert.equal(r.queued, 1, "the mapped one is scanned");
  assert.equal(r.mapping, 1, "the unmapped one is queued for mapping");
  assert.deepEqual(typesQueued(), ["leveling-map", "watchlist-scan"]);
});

// Idempotent, like every other enqueue here — re-running must not stack duplicates.
test("re-running does not duplicate a mapping job already in flight", () => {
  seedCo("Airbnb");
  queueStaleWatchlistScans();
  const second = queueStaleWatchlistScans();
  assert.equal(second.mapping, 0, "already queued");
  assert.equal(listJobs().length, 1);
});

// A cooling company gets neither — the point of a cooldown is that its work stops arriving, and
// mapping it would be research nobody reads.
test("a cooling company is neither mapped nor scanned", () => {
  const id = seedCo("Rejector");
  setCompanyCooldown(id, "2099-01-01");

  const r = queueStaleWatchlistScans();
  assert.equal(listJobs().length, 0);
  assert.equal(r.cooling, 1);
});

// The per-row "Scan now" button is an explicit instruction, and it carries the same precondition:
// scanning without a ladder is the thing we're preventing, whoever asked for it.
test("scan-now maps first when the company has no ladder", () => {
  seedCo("Airbnb");
  const r = queueWatchlistScan("Airbnb");

  assert.equal(r.status, "mapping", "it says what it did instead");
  assert.deepEqual(typesQueued(), ["leveling-map"]);
});

test("scan-now scans directly when the ladder is there", () => {
  seedCo("Amazon");
  upsertCompanies([{ name: "Amazon", ladderMap: goodMap }]);

  assert.equal(queueWatchlistScan("Amazon").status, "queued");
  assert.deepEqual(typesQueued(), ["watchlist-scan"]);
});

// A map too degraded to use is the same as no map — the gate would read it as a real answer.
test("an unreadable ladder map counts as missing", () => {
  const id = seedCo("Broken");
  db.update(companies).set({ ladderMap: "{not json" }).where(eq(companies.id, id)).run();

  assert.equal(queueStaleWatchlistScans().mapping, 1);
});

// ── the state-machine edge: mapped → scan ─────────────────────────────────────────────────────
// The precondition above is a HAND-OFF, not a skip. The sweep — which every queue read and every
// wait tick already calls — notices a company whose ladder has landed and queues its scan. So one
// press of "Scrape watchlist" carries an unmapped company all the way through.
test("the sweep scans a company once its ladder map lands", () => {
  seedCo("Airbnb");
  queueStaleWatchlistScans();                                   // → leveling-map
  assert.deepEqual(typesQueued(), ["leveling-map"]);

  upsertCompanies([{ name: "Airbnb", ladderMap: goodMap }]);     // the agent stores the map
  assert.equal(sweepQueue().scansQueued, 1);
  assert.ok(typesQueued().includes("watchlist-scan"), "the scan follows on its own");
});

// It must not scan into a dead end: a company still without a usable ladder is left alone, which is
// the whole point of the precondition.
test("the sweep leaves an unmapped company alone", () => {
  seedCo("Airbnb");
  queueStaleWatchlistScans();
  assert.equal(sweepQueue().scansQueued, 0);
  assert.equal(typesQueued().includes("watchlist-scan"), false);
});

// A sweep is stronger than an event precisely here: it runs on every tick, so it must never stack
// duplicates or re-scan a company that has already been scanned once.
test("the sweep is idempotent and skips already-scanned companies", () => {
  seedCo("Amazon");
  upsertCompanies([{ name: "Amazon", ladderMap: goodMap }]);

  assert.equal(sweepQueue().scansQueued, 1);
  assert.equal(sweepQueue().scansQueued, 0, "the queued job is not duplicated");

  db.update(companies).set({ lastScrapedAt: new Date().toISOString() }).where(eq(companies.name, "Amazon")).run();
  assert.equal(sweepQueue().scansQueued, 0, "and a scanned company isn't re-queued by the sweep");
});

// The chain must cover the case that actually matters in practice: a company scanned BEFORE it had
// a ladder. Keying only on "never scanned" left 48 mapped companies un-chained, because almost every
// company had been scanned at some point under the old, unlevelled rules — exactly the scans the
// map was meant to improve.
test("a company scanned before its map was made is re-scanned", () => {
  const id = seedCo("Airbnb");
  db.update(companies)
    .set({ lastScrapedAt: "2026-08-25T00:00:00.000Z" })
    .where(eq(companies.id, id))
    .run();
  upsertCompanies([{ name: "Airbnb", ladderMap: { ...goodMap, checkedAt: "2026-09-04T00:00:00.000Z" } }]);

  assert.equal(sweepQueue().scansQueued, 1, "the map is newer than the scan, so the scan is stale");
});

test("a company scanned after its map is left alone", () => {
  const id = seedCo("Airbnb");
  upsertCompanies([{ name: "Airbnb", ladderMap: { ...goodMap, checkedAt: "2026-08-01T00:00:00.000Z" } }]);
  db.update(companies)
    .set({ lastScrapedAt: "2026-09-04T00:00:00.000Z" })
    .where(eq(companies.id, id))
    .run();

  assert.equal(sweepQueue().scansQueued, 0, "that scan already had the ladder");
});
