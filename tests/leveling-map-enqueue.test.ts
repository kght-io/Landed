import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, db, companies } from "./helpers";
import { queueMissingLadderMaps, queueLadderMap } from "@landed/backend/jobs/enqueue/leveling-map";
import { listJobs } from "@landed/backend/jobs/queue";
import { upsertCompanies } from "@landed/backend/db/queries";
import { setCompanyCooldown } from "@landed/backend/db/cooldown";

beforeEach(() => reset());

const seedCo = (name: string, watchlist = true) =>
  db.insert(companies).values({ name, tier: "tier1", watchlist }).returning({ id: companies.id }).get().id;

const jobIds = () => listJobs().map((j) => j.id);

const goodMap = {
  rungs: [{ rung: "L6", titles: ["Senior Software Development Engineer"], bands: ["senior"] }],
  source: "model+search",
  reason: "levels.fyi and Amazon's postings agree",
  checkedAt: "2026-08-22T00:00:00.000Z",
};

test("a watchlisted company with no ladder map gets one job", () => {
  const id = seedCo("Amazon");
  const r = queueMissingLadderMaps();
  assert.equal(r.queued, 1);
  assert.deepEqual(jobIds(), [`leveling-map-${id}`]);
});

// One per company, ever — the whole reason 2a is split out of the scan is that researching a ladder
// is per-company work, not per-posting.
test("a company that already has a map is skipped", () => {
  seedCo("Amazon");
  upsertCompanies([{ name: "Amazon", ladderMap: goodMap }]);
  assert.equal(queueMissingLadderMaps().queued, 0);
});

// Deterministic id → idempotent. Re-running must not stack duplicates or disturb one in flight.
test("re-running does not duplicate an in-flight job", () => {
  seedCo("Amazon");
  queueMissingLadderMaps();
  const second = queueMissingLadderMaps();
  assert.equal(second.queued, 0);
  assert.equal(second.skipped, 1);
  assert.equal(jobIds().length, 1);
});

test("companies off the watchlist are left alone", () => {
  seedCo("Ignored", false);
  assert.equal(queueMissingLadderMaps().queued, 0);
});

// A cooling company isn't scanned at all, so its ladder is work nobody will use. Same reasoning as
// the scan's own cooldown skip — the point of a cooldown is that its jobs stop arriving.
test("a company cooling off after a rejection is not researched", () => {
  const id = seedCo("Rejector");
  setCompanyCooldown(id, "2099-01-01");
  const r = queueMissingLadderMaps();
  assert.equal(r.queued, 0);
  assert.equal(r.cooling, 1);
});

test("the single-company path queues on demand", () => {
  const id = seedCo("Figma");
  assert.deepEqual(queueLadderMap("Figma"), { status: "queued", company: "Figma" });
  assert.deepEqual(jobIds(), [`leveling-map-${id}`]);
});

// An explicit re-check must be possible: ladders get renamed, and a stored map can be wrong. Unlike
// the sweep, the per-company path ignores whether a map already exists.
test("the single-company path re-researches a company that already has a map", () => {
  seedCo("Figma");
  upsertCompanies([{ name: "Figma", ladderMap: goodMap }]);
  assert.equal(queueLadderMap("Figma").status, "queued");
});

test("the single-company path reports an in-flight job rather than duplicating", () => {
  seedCo("Figma");
  queueLadderMap("Figma");
  assert.deepEqual(queueLadderMap("Figma"), { status: "in-flight", company: "Figma" });
});

test("an unknown company is reported, not queued", () => {
  assert.deepEqual(queueLadderMap("Nobody"), { status: "not-found" });
  assert.equal(jobIds().length, 0);
});
