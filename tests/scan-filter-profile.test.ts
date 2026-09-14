import "./setup";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reset, db, companies, postings, realRepoPath, mockGreenhouse } from "./helpers";
import { applyGlance } from "@landed/backend/db/queries";
import { scanCompany } from "@landed/backend/jobs/scan";
import { getProfile, setProfile, profileVersions } from "@landed/backend/db/profile";
import { setConfig } from "@landed/backend/db/config-store";

// Stage 1's filter is the profile's. The non-engineering title terms, the locales that don't count as
// in range, and the signals that re-allow a dual-country posting all used to be regexes in code —
// preferences with no way to see or change them short of an edit and a deploy. These tests pin that
// the scan and the glance-submit path read them from the profile and nowhere else.

const realFetch = globalThis.fetch;
beforeEach(() => {
  reset();
  setProfile({ locations: "New York, Remote" });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const rowFor = (title: string) => db.select().from(postings).all().find((r) => r.title === title);

const seedBoard = (name: string) =>
  db.insert(companies).values({ name, tier: "tier1", ats: "greenhouse", slug: "acme", fetchMethod: "api", watchlist: true }).run();

// ── title terms ───────────────────────────────────────────────────────────────────────────────
test("a title term added on the profile drops at scan", async () => {
  setProfile({ excludeTitleTerms: ["quantum"] });
  seedBoard("Acme");
  mockGreenhouse([{ id: 1, title: "Quantum Software Engineer", location: "New York, NY" }]);
  await scanCompany("Acme", false);
  assert.equal(rowFor("Quantum Software Engineer")!.reason, "excluded");
});

// The proof there's no floor left in code: take a default term off the list and the posting it
// used to drop gets through.
test("a title term removed from the profile stops dropping", async () => {
  setProfile({ excludeTitleTerms: [] });
  seedBoard("Acme");
  mockGreenhouse([{ id: 2, title: "Enterprise Sales Engineer", location: "New York, NY" }]);
  await scanCompany("Acme", false);
  assert.equal(rowFor("Enterprise Sales Engineer")!.state, "matched");
});

// The glance-submit override is the same filter, so it has to read the same list — otherwise a
// browser-fetched board and an api-fetched board would be filtered by different rules.
test("the glance-submit override reads the profile's title terms", () => {
  setProfile({ excludeTitleTerms: ["quantum"] });
  db.insert(companies).values({ name: "Figma", tier: "tier1", watchlist: true }).run();
  applyGlance({ company: "Figma", title: "Quantum Engineer", glance: "high" });
  applyGlance({ company: "Figma", title: "Enterprise Sales Engineer", glance: "high" });
  assert.equal(rowFor("Quantum Engineer")!.reason, "excluded");
  assert.equal(rowFor("Enterprise Sales Engineer")!.state, "review", "a default term no longer on the list doesn't drop");
});

// ── location terms ────────────────────────────────────────────────────────────────────────────
// A dropped-for-location posting is never filed at all, so "not dropped" is "a row exists".
test("an excluded locale on the profile drops a remote posting there", async () => {
  setProfile({ excludeLocationTerms: ["mars"], allowLocationTerms: [] });
  seedBoard("Acme");
  mockGreenhouse([
    { id: 3, title: "Backend Engineer A", location: "Remote - Mars" },
    { id: 4, title: "Backend Engineer B", location: "Remote - Canada" },
  ]);
  await scanCompany("Acme", false);
  assert.equal(rowFor("Backend Engineer A"), undefined, "the profile's locale is dropped");
  assert.ok(rowFor("Backend Engineer B"), "a locale that is no longer on the list is kept");
});

// "Remote - US/Canada" names an excluded locale AND a place you'd work. The allow list is what keeps
// a dual posting from being thrown out for mentioning the second country.
test("an allow term keeps a posting that also names an excluded locale", async () => {
  setProfile({ excludeLocationTerms: ["canada"], allowLocationTerms: ["us"] });
  seedBoard("Acme");
  mockGreenhouse([
    { id: 5, title: "Dual", location: "Remote - US/Canada" },
    { id: 6, title: "Canada only", location: "Remote - Canada" },
  ]);
  await scanCompany("Acme", false);
  assert.ok(rowFor("Dual"));
  assert.equal(rowFor("Canada only"), undefined);
});

// Targeting a place you've also excluded means you want it — the guard stands down rather than
// dropping the very city you asked for.
test("a target location that names an excluded locale opts out of the guard", async () => {
  setProfile({ locations: "Toronto, Remote", excludeLocationTerms: ["toronto", "canada"], allowLocationTerms: [] });
  seedBoard("Acme");
  mockGreenhouse([{ id: 7, title: "Toronto role", location: "Toronto, ON" }]);
  await scanCompany("Acme", false);
  assert.ok(rowFor("Toronto role"));
});

// ── the migration off the alias table ─────────────────────────────────────────────────────────
// `nyc`, `ny` and `anywhere` used to be implied by "New York" and "Remote" through an alias map in
// code. Removing the map must not stop matching the postings it matched, so a profile saved before
// this change gets those spellings written into its locations, where they're visible and editable.
test("a pre-change profile keeps matching the spellings its locations used to imply", async () => {
  setConfig("profile", JSON.stringify({ locations: "New York, Remote" }));
  const loc = getProfile().locations.toLowerCase();
  for (const t of ["nyc", "ny", "anywhere"]) assert.match(loc, new RegExp(`\\b${t}\\b`), `${t} is now explicit`);

  seedBoard("Acme");
  mockGreenhouse([{ id: 8, title: "Alias role", location: "NYC" }]);
  await scanCompany("Acme", false);
  assert.ok(rowFor("Alias role"), "a posting located only as NYC is still in range");
});

test("a profile saved after the change is never re-expanded", () => {
  setProfile({ locations: "Seattle" });
  assert.equal(getProfile().locations, "Seattle");
});

// ── eras ──────────────────────────────────────────────────────────────────────────────────────
// Same direction rule as the other lists: only a change that widens the filter invalidates labels.
test("loosening a stage-1 list opens an era; tightening doesn't", () => {
  const base = profileVersions().length;
  setProfile({ excludeTitleTerms: [...getProfile().excludeTitleTerms, "quantum"] });
  setProfile({ excludeLocationTerms: [...getProfile().excludeLocationTerms, "mars"] });
  assert.equal(profileVersions().length, base, "adding exclusions narrows");

  setProfile({ allowLocationTerms: [...getProfile().allowLocationTerms, "mars"] });
  assert.deepEqual(profileVersions().at(-1)!.changed, ["allowLocationTerms"], "an allow term widens");

  setProfile({ excludeTitleTerms: getProfile().excludeTitleTerms.filter((t) => t !== "quantum") });
  assert.deepEqual(profileVersions().at(-1)!.changed, ["excludeTitleTerms"], "removing an exclusion widens");
});

// ── nothing left in code ──────────────────────────────────────────────────────────────────────
// The requirement is that the filter's vocabulary is the profile's alone. Comments may still name
// examples; code may not. A term from each retired list stands in for the list.
test("the stage-1 filter code carries no term lists", () => {
  const code = (p: string) =>
    readFileSync(realRepoPath(...p.split("/")), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  for (const file of ["shared/src/jobs/exclude.ts", "backend/src/jobs/scan.ts"]) {
    assert.doesNotMatch(code(file), /\b(marketing|recruit|canada|toronto|nyc|anywhere|united states)\b/i, `${file} has no hardcoded terms`);
  }
});
