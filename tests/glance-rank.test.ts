import "./setup";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { reset, db, companies, postings } from "./helpers";
import { applyGlance, upsertCompanies } from "@landed/backend/db/queries";
import { scanCompany } from "@landed/backend/jobs/scan";
import { setProfile } from "@landed/backend/db/profile";

beforeEach(() => {
  reset();
  setProfile({ locations: "New York, Remote" });
});

const seedCo = (name: string) =>
  db.insert(companies).values({ name, tier: "tier1", watchlist: true }).returning({ id: companies.id }).get().id;

const rowFor = (title: string) => db.select().from(postings).all().find((r) => r.title === title);

// ── 2c: the rank ──────────────────────────────────────────────────────────────────────────────
// The rank is what lets the triage view group a company and put the role you'd actually pick at the
// top. Without it stored, the grouped view has nothing to order by.
test("a glance can carry a rank, and it is stored", () => {
  seedCo("Figma");
  applyGlance({ company: "Figma", title: "SWE - Data Infrastructure", glance: "high", rank: 1 });
  applyGlance({ company: "Figma", title: "SWE - Traffic", glance: "high", rank: 2 });

  assert.equal(rowFor("SWE - Data Infrastructure")!.glanceRank, 1);
  assert.equal(rowFor("SWE - Traffic")!.glanceRank, 2);
});

test("a glance with no rank leaves it null rather than inventing a position", () => {
  seedCo("Figma");
  applyGlance({ company: "Figma", title: "SWE - Traffic", glance: "high" });
  assert.equal(rowFor("SWE - Traffic")!.glanceRank, null);
});

// Agent input is untrusted: a rank of 0, -1, or "second" must not land in a column the UI sorts on.
test("a nonsense rank is discarded, not stored", () => {
  seedCo("Figma");
  applyGlance({ company: "Figma", title: "a", glance: "high", rank: 0 });
  applyGlance({ company: "Figma", title: "b", glance: "high", rank: -3 });
  applyGlance({ company: "Figma", title: "c", glance: "high", rank: "second" as never });

  assert.equal(rowFor("a")!.glanceRank, null);
  assert.equal(rowFor("b")!.glanceRank, null);
  assert.equal(rowFor("c")!.glanceRank, null);
});

// ── 2b: the level call ────────────────────────────────────────────────────────────────────────
// Recording the band is what makes "widened" countable. A gate that silently declined to drop is
// indistinguishable from one that never looked.
test("the resolved seniority bands are stored", () => {
  seedCo("Anthropic");
  applyGlance({ company: "Anthropic", title: "Staff+ SWE, Inference", glance: "high", bands: ["staff"] });
  assert.deepEqual(JSON.parse(rowFor("Staff+ SWE, Inference")!.glanceBands!), ["staff"]);
});

// The recall rule made observable: more than one band means the gate refused to guess, and that
// refusal is the thing the funnel reports as "widened".
test("an ambiguous call keeps every band rather than collapsing to one", () => {
  seedCo("Anthropic");
  applyGlance({ company: "Anthropic", title: "Member of Technical Staff", glance: "high", bands: ["senior", "staff"] });
  assert.deepEqual(JSON.parse(rowFor("Member of Technical Staff")!.glanceBands!), ["senior", "staff"]);
});

test("an unrecognized band is dropped without poisoning the rest", () => {
  seedCo("Anthropic");
  applyGlance({ company: "Anthropic", title: "x", glance: "high", bands: ["staff", "wizard"] as never });
  assert.deepEqual(JSON.parse(rowFor("x")!.glanceBands!), ["staff"]);
});

test("a glance with no bands leaves the column null", () => {
  seedCo("Anthropic");
  applyGlance({ company: "Anthropic", title: "y", glance: "high" });
  assert.equal(rowFor("y")!.glanceBands, null);
});

// ── the mechanical gates that moved out of stage 1 ────────────────────────────────────────────
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockGreenhouse(jobs: { id: number; title: string; location: string; dept?: string }[]) {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    const body = u.includes("/departments")
      ? { departments: jobs.map((j) => ({ name: j.dept ?? "Engineering", jobs: [{ id: j.id }] })) }
      : {
          jobs: jobs.map((j) => ({
            id: j.id,
            title: j.title,
            location: { name: j.location },
            absolute_url: `https://example.com/${j.id}`,
            updated_at: "2026-08-01T00:00:00Z",
          })),
        };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function seedBoard(name: string, titles: string[]) {
  db.insert(companies)
    .values({ name, tier: "tier1", ats: "greenhouse", slug: "acme", fetchMethod: "api", watchlist: true, targetTitles: JSON.stringify(titles) })
    .run();
}

// This is the 150-posting bug. Airbnb's targetTitles was ["Senior"], so every Staff role it posted
// was dropped as out-of-level by a substring match — before anything that understood the ladder ever
// saw it. The level judgment belongs to 2b, which has the company's rung mapping.
test("a Staff role is no longer dropped just because targetTitles says Senior", async () => {
  seedBoard("Airbnb", ["Senior"]);
  mockGreenhouse([{ id: 1, title: "Staff Backend Engineer, Host Pricing", location: "New York, NY" }]);

  await scanCompany("Airbnb", false);

  const row = rowFor("Staff Backend Engineer, Host Pricing")!;
  assert.notEqual(row.reason, "level", "the mechanical level gate is gone");
  assert.equal(row.state, "matched", "it reaches the agent instead of dying at stage 1");
});

// Anthropic's list dropped every unlevelled title it posts. Same gate, same fix.
test("an unlevelled title survives stage 1", async () => {
  seedBoard("Anthropic", ["Senior", "Staff", "Lead"]);
  mockGreenhouse([{ id: 2, title: "Software Engineer, Research Infrastructure", location: "Remote" }]);

  await scanCompany("Anthropic", false);
  assert.equal(rowFor("Software Engineer, Research Infrastructure")!.state, "matched");
});

// "No positive SWE signal" was never evidence of a bad role — it's the absence of evidence. Those
// go to the ranker to be sorted low, not to the bin.
test("a title with no recognized SWE signal is kept for ranking, not filtered", async () => {
  seedBoard("Acme", []);
  mockGreenhouse([{ id: 3, title: "Performance Engineer", location: "New York, NY", dept: "Research" }]);

  await scanCompany("Acme", false);

  const row = rowFor("Performance Engineer")!;
  assert.notEqual(row.reason, "unmatched");
  assert.equal(row.state, "matched");
});

// The gates that stayed. NON_ENG is high-confidence and carries 1207 of the drops — moving it would
// have flooded the agent with sales roles for no recall gain.
test("the non-engineering filter still drops at stage 1", async () => {
  seedBoard("Acme", []);
  mockGreenhouse([{ id: 4, title: "Enterprise Sales Engineer", location: "New York, NY", dept: "Sales" }]);

  await scanCompany("Acme", false);

  const row = rowFor("Enterprise Sales Engineer")!;
  assert.equal(row.reason, "excluded");
  assert.equal(row.state, "filtered");
});

// ── handing the agent its context ─────────────────────────────────────────────────────────────
// The scan result carries the company's rung mapping, so the glance has what it needs to make a
// level call in the same payload as the postings. Same principle as the tailoring handoff: give the
// agent its context rather than making it go find it.
test("a scan result carries the company's ladder map", async () => {
  seedBoard("Amazon", []);
  upsertCompanies([{
    name: "Amazon",
    ladderMap: {
      rungs: [{ rung: "L6", titles: ["Senior Software Development Engineer"], bands: ["senior"] }],
      source: "model+search",
      reason: "levels.fyi and Amazon postings agree",
    },
  }]);
  mockGreenhouse([{ id: 9, title: "Senior Software Development Engineer, Ads", location: "New York, NY" }]);

  const r = await scanCompany("Amazon", false);
  assert.ok(r.ladderMap, "the mapping rides along with the shortlist");
  assert.equal(r.ladderMap!.rungs[0].rung, "L6");
});

// Absent is normal — 2a hasn't run for every company — and must not look like an empty ladder.
test("a company with no ladder map reports it as absent, not empty", async () => {
  seedBoard("Unmapped", []);
  mockGreenhouse([{ id: 10, title: "Software Engineer", location: "Remote" }]);

  const r = await scanCompany("Unmapped", false);
  assert.equal(r.ladderMap, null);
});
