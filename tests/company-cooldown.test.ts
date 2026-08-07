import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { reset, seedApp, seedCandidate, db, companies, events, postings } from "./helpers";
import { interviews } from "@landed/backend/db/schema";
import { applyGlance, listScannedPostings, scannedBucketCounts, setWatchlist, updateApplication, upsertCompanies } from "@landed/backend/db/queries";
import { setCompanyCooldown } from "@landed/backend/db/cooldown";
import { queueStaleWatchlistScans } from "@landed/backend/jobs/store";
import { ingestDiscovered } from "@landed/backend/jobs/ingest";
import type { InterviewKind } from "@landed/shared/types";

beforeEach(() => reset());

const coolingUntil = (name: string): string | null =>
  db.select().from(companies).all().find((c) => c.name === name)?.cooldownUntil ?? null;

// Attach interview rounds to a posting — the difference between a real loop and a recruiter screen,
// which is what the whole rule turns on.
function addRounds(postingId: number, kinds: InterviewKind[]) {
  kinds.forEach((kind, i) => db.insert(interviews).values({ applicationId: postingId, round: i + 1, kind }).run());
}

test("a rejection after a real interview cools the company", () => {
  const id = seedApp({ company: "Google", status: "applied", interviewed: true });
  addRounds(id, ["technical", "behavioral"]);
  updateApplication(id, { status: "rejected", updatedAt: "2026-07-30" });
  assert.equal(coolingUntil("Google"), "2027-01-30");
});

test("a rejection with interviewed=true but no rounds logged does NOT cool", () => {
  const id = seedApp({ company: "Databricks", status: "applied", interviewed: true });
  updateApplication(id, { status: "rejected", updatedAt: "2026-07-02" });
  assert.equal(coolingUntil("Databricks"), null);
});

test("a rejection after only a recruiter screen does NOT cool", () => {
  const id = seedApp({ company: "Arch", status: "applied", interviewed: true });
  addRounds(id, ["recruiter_screen"]);
  updateApplication(id, { status: "rejected", updatedAt: "2026-06-26" });
  assert.equal(coolingUntil("Arch"), null);
});

test("the cooldown counts from the rejection date, not from today", () => {
  const id = seedApp({ company: "Backdated", status: "applied" });
  addRounds(id, ["onsite"]);
  updateApplication(id, { status: "rejected", updatedAt: "2026-06-15" });
  assert.equal(coolingUntil("Backdated"), "2026-12-15");
});

test("a rejection older than six months is already spent — it doesn't start a fresh cooldown", () => {
  const id = seedApp({ company: "Ancient", status: "applied" });
  addRounds(id, ["onsite"]);
  updateApplication(id, { status: "rejected", updatedAt: "2020-01-15" });
  assert.equal(coolingUntil("Ancient"), null);
});

test("a company you're still interviewing with elsewhere is not cooled", () => {
  const rejected = seedApp({ company: "Stripe", status: "applied" });
  addRounds(rejected, ["technical"]);
  seedApp({ company: "Stripe", role: "Another team", status: "interview" });
  updateApplication(rejected, { status: "rejected", updatedAt: "2026-07-30" });
  assert.equal(coolingUntil("Stripe"), null);
});

test("a second rejection extends the cooldown but never shortens it", () => {
  const first = seedApp({ company: "Meta", role: "A", status: "applied" });
  addRounds(first, ["technical"]);
  updateApplication(first, { status: "rejected", updatedAt: "2026-07-01" });
  assert.equal(coolingUntil("Meta"), "2027-01-01");

  const later = seedApp({ company: "Meta", role: "B", status: "applied" });
  addRounds(later, ["onsite"]);
  updateApplication(later, { status: "rejected", updatedAt: "2026-09-01" });
  assert.equal(coolingUntil("Meta"), "2027-03-01", "a later rejection should push the date out");

  const earlier = seedApp({ company: "Meta", role: "C", status: "applied" });
  addRounds(earlier, ["onsite"]);
  updateApplication(earlier, { status: "rejected", updatedAt: "2026-02-01" });
  assert.equal(coolingUntil("Meta"), "2027-03-01", "an older rejection must not pull the date back");
});

test("a hand-set longer cooldown is not shortened by a later rejection", () => {
  const first = seedApp({ company: "Google", role: "A", status: "applied" });
  addRounds(first, ["technical"]);
  updateApplication(first, { status: "rejected", updatedAt: "2026-07-30" });
  const co = db.select().from(companies).all().find((c) => c.name === "Google")!;
  setCompanyCooldown(co.id, "2028-01-01");

  const second = seedApp({ company: "Google", role: "B", status: "applied" });
  addRounds(second, ["onsite"]);
  updateApplication(second, { status: "rejected", updatedAt: "2026-08-01" });
  assert.equal(coolingUntil("Google"), "2028-01-01");
});

// Clearing is a decision, not a suggestion: only a genuinely NEW qualifying rejection may re-cool a
// company. Recomputing over its whole history would resurrect what you just dismissed.
test("a cleared cooldown stays cleared when something else at the company changes", () => {
  const rejected = seedApp({ company: "Google", role: "A", status: "applied" });
  addRounds(rejected, ["technical"]);
  updateApplication(rejected, { status: "rejected", updatedAt: "2026-07-30" });
  const co = db.select().from(companies).all().find((c) => c.name === "Google")!;
  assert.equal(setCompanyCooldown(co.id, null), null);

  // Another posting there is rejected — but only after a recruiter screen, so it earns nothing, and
  // the old real-interview rejection must not be re-counted.
  const screened = seedApp({ company: "Google", role: "B", status: "applied" });
  addRounds(screened, ["recruiter_screen"]);
  updateApplication(screened, { status: "rejected", updatedAt: "2026-08-02" });
  assert.equal(coolingUntil("Google"), null);

  // A NEW real-interview rejection does re-cool it.
  const real = seedApp({ company: "Google", role: "C", status: "applied" });
  addRounds(real, ["onsite"]);
  updateApplication(real, { status: "rejected", updatedAt: "2026-08-03" });
  assert.equal(coolingUntil("Google"), "2027-02-03");
});

test("an unparseable cooldown date is rejected rather than stored", () => {
  upsertCompanies([{ name: "Acme", cooldownUntil: "2027-01-30" }]);
  assert.equal(coolingUntil("Acme"), "2027-01-30");
  upsertCompanies([{ name: "Acme", cooldownUntil: "6 months" }]);
  assert.equal(coolingUntil("Acme"), "2027-01-30", "junk must not overwrite a real date");
  upsertCompanies([{ name: "Acme", cooldownUntil: "2026-02-30" }]);
  assert.equal(coolingUntil("Acme"), "2027-01-30", "a date that doesn't exist is junk too");
  upsertCompanies([{ name: "Acme", cooldownUntil: null }]);
  assert.equal(coolingUntil("Acme"), null, "null clears");
});

// The hand-set path and the automatic one write through the same function, so a cooldown you set
// yourself is as auditable as one the app decided on. Junk never reaches the log, because it never
// reaches the column.
test("setting or clearing a cooldown by hand is recorded in the change log", () => {
  const cooldownEvents = () =>
    db.select().from(events).all().filter((e) => e.field === "cooldownUntil").map((e) => e.newValue ?? null);

  upsertCompanies([{ name: "Acme", cooldownUntil: "2027-01-30" }]);
  assert.deepEqual(cooldownEvents(), ["2027-01-30"]);

  upsertCompanies([{ name: "Acme", cooldownUntil: "6 months" }]);
  assert.deepEqual(cooldownEvents(), ["2027-01-30"], "junk is not stored, so it logs nothing");

  upsertCompanies([{ name: "Acme", cooldownUntil: "2027-01-30" }]);
  assert.deepEqual(cooldownEvents(), ["2027-01-30"], "re-setting the same date is not a change");

  upsertCompanies([{ name: "Acme", cooldownUntil: null }]);
  assert.deepEqual(cooldownEvents(), ["2027-01-30", null], "clearing is a change worth logging");
});

// --- what the cooldown actually suppresses ------------------------------------------------------

const far = "2099-01-01"; // comfortably still cooling

test("a cooling company is not queued for a watchlist scan", () => {
  setWatchlist("Google", true);
  setWatchlist("Anthropic", true);
  upsertCompanies([{ name: "Google", cooldownUntil: far }]);
  const r = queueStaleWatchlistScans();
  assert.deepEqual({ queued: r.queued, cooling: r.cooling }, { queued: 1, cooling: 1 });
  assert.equal(listScannedPostings().length, 0);
});

test("a cooldown that has already lapsed does not block a scan", () => {
  setWatchlist("Google", true);
  upsertCompanies([{ name: "Google", cooldownUntil: "2020-01-01" }]);
  assert.deepEqual(queueStaleWatchlistScans().queued, 1);
});

test("an agent glance for a cooling company is filed away, not put in front of you", () => {
  upsertCompanies([{ name: "Google", cooldownUntil: far }]);
  applyGlance({ company: "Google", title: "Senior Software Engineer", url: "u1", glance: "high" });
  const row = db.select().from(postings).all().find((p) => p.url === "u1")!;
  assert.equal(row.state, "filtered");
  assert.equal(row.reason, "cooldown");
  assert.equal(listScannedPostings({ state: "review" }).length, 0);
});

test("a glance can't demote work you've already committed to", () => {
  upsertCompanies([{ name: "Google", cooldownUntil: far }]);
  const id = seedApp({ company: "Google", role: "Applied role", status: "applied" });
  db.update(postings).set({ url: "u2" }).where(eq(postings.id, id)).run();
  applyGlance({ company: "Google", title: "Applied role", url: "u2", glance: "high" });
  assert.equal(db.select().from(postings).where(eq(postings.id, id)).get()!.state, "applied");
});

test("scan results ingested for a cooling company land filed, not in the fit queue", () => {
  upsertCompanies([{ name: "Google", cooldownUntil: far }]);
  ingestDiscovered("watchlist-scan")([{ company: "Google", role: "Staff Engineer", url: "u3" }]);
  const row = db.select().from(postings).all().find((p) => p.url === "u3")!;
  assert.equal(row.state, "filtered");
  assert.equal(row.reason, "cooldown");
});

test("existing discovery rows are HIDDEN, not destroyed, and tailoring work stays visible", () => {
  seedCandidate({ company: "Google", title: "Untriaged", state: "fit_queue" });
  seedCandidate({ company: "Google", title: "Waiting", state: "apply_later" });
  const tailored = seedCandidate({ company: "Google", title: "Tailored already", state: "tailoring" });
  seedCandidate({ company: "Anthropic", title: "Elsewhere", state: "fit_queue" });
  upsertCompanies([{ name: "Google", cooldownUntil: far }]);

  const visible = listScannedPostings().map((p) => p.title).sort();
  assert.deepEqual(visible, ["Elsewhere", "Tailored already"]);
  assert.equal(scannedBucketCounts().fit_queue, 1, "only Anthropic's row should be counted");
  // The rows are still there — hiding is a read-time decision.
  assert.equal(db.select().from(postings).all().length, 4);
  assert.equal(db.select().from(postings).where(eq(postings.id, tailored)).get()!.state, "tailoring");

  // …and clearing the cooldown brings them straight back.
  const co = db.select().from(companies).all().find((c) => c.name === "Google")!;
  setCompanyCooldown(co.id, null);
  assert.equal(listScannedPostings().length, 4);
});
