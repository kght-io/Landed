import "./setup";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { reset, db, companies, postings } from "./helpers";
import { scanCompany } from "@landed/backend/jobs/scan";
import { setProfile } from "@landed/backend/db/profile";

beforeEach(() => {
  reset();
  // The location gate runs before everything else and never files a non-local row at all, so the
  // fixture postings have to sit inside the profile's target area or there'd be nothing to stamp.
  setProfile({ locations: "New York, Remote" });
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Stand in for the Greenhouse board API. scanCompany hits /jobs and /departments; anything else
// would be a per-job JD fetch, which `withJd: false` skips.
function mockGreenhouse(jobs: { id: number; title: string; location: string }[]) {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    const body = u.includes("/departments")
      ? { departments: [{ name: "Engineering", jobs: jobs.map((j) => ({ id: j.id })) }] }
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

function seedBoard(name: string): number {
  return db
    .insert(companies)
    .values({ name, tier: "tier1", ats: "greenhouse", slug: "acme", fetchMethod: "api", watchlist: true })
    .returning({ id: companies.id })
    .get().id;
}

const rowFor = (title: string) => db.select().from(postings).all().find((r) => r.title === title);

// `scanned_at` is refreshed on EVERY rescan — it records the last sighting, not the first — so it
// can't order a company's board by age. `discovered_at` is the first-seen stamp the scan eval needs
// to reconstruct what was on a board when; before this it was populated on 14 of 2834 rows.
test("a newly scanned posting gets a discovered_at stamp", async () => {
  seedBoard("Acme");
  mockGreenhouse([{ id: 1, title: "Senior Software Engineer", location: "New York, NY" }]);

  await scanCompany("Acme", false);

  const row = rowFor("Senior Software Engineer");
  assert.ok(row, "the posting was filed");
  assert.ok(row!.discoveredAt, "discovered_at was stamped on insert");
});

// The whole point of a first-seen stamp: a rescan must not move it. `scanned_at` advances, this
// one doesn't — that's the difference between the two columns.
test("a rescan advances scanned_at but never rewrites discovered_at", async () => {
  seedBoard("Acme");
  mockGreenhouse([{ id: 1, title: "Senior Software Engineer", location: "New York, NY" }]);

  await scanCompany("Acme", false);
  const first = rowFor("Senior Software Engineer")!;

  await scanCompany("Acme", false);
  const second = rowFor("Senior Software Engineer")!;

  assert.ok(first.discoveredAt, "there is a first-seen stamp to preserve");
  assert.equal(second.discoveredAt, first.discoveredAt, "first-seen is preserved across rescans");
  assert.ok(second.scannedAt >= first.scannedAt, "last-seen still advances");
});

// Dropped rows are filed too (everything except `location`, which is never filed at all), and the
// eval ranks against a company's whole historical board — so they need the stamp as much as keeps do.
test("a filtered posting is stamped too", async () => {
  seedBoard("Acme");
  mockGreenhouse([{ id: 2, title: "Sales Engineer", location: "New York, NY" }]);

  await scanCompany("Acme", false);

  const row = rowFor("Sales Engineer");
  assert.ok(row, "the dropped posting was still filed");
  assert.equal(row!.state, "filtered");
  assert.ok(row!.discoveredAt, "discovered_at was stamped on insert");
});
