import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset } from "./helpers";
import { getProfile, setProfile, profileVersions, addExclusions } from "@landed/backend/db/profile";
import { setConfig, getConfig } from "@landed/backend/db/config-store";
import { agentProfile } from "@landed/backend/db/prompts";
import { EXCLUDE_FIELD, axisForReason } from "@landed/shared/jobs/dismiss";

beforeEach(() => reset());

// One `excludeDisciplines` list can't answer the question the discard labels ask. A `role` discard
// and a `domain` discard are different rejections — "data engineer" is the wrong JOB, "crypto" is the
// wrong PROBLEM — and collapsing them into one bag means neither can be fed back without also
// asserting the other.
const legacy = (values: string[]) =>
  setConfig("profile", JSON.stringify({ levelBaseline: "Senior", excludeDisciplines: values }));

test("a legacy excludeDisciplines list is split across the three axes", () => {
  legacy(["mobile (iOS / Android)", "data engineering", "blockchain"]);
  const p = getProfile();
  assert.deepEqual(p.excludeStacks, ["mobile (iOS / Android)"]);
  assert.deepEqual(p.excludeRoles, ["data engineering"]);
  assert.deepEqual(p.excludeDomains, ["blockchain"]);
});

// Nothing may be dropped on the floor. A term the seed vocabulary doesn't recognise still has to
// land somewhere, or migrating silently loosens the filter.
test("an unrecognised discipline lands on the role axis rather than vanishing", () => {
  legacy(["quantum widgetry"]);
  const p = getProfile();
  assert.deepEqual(p.excludeRoles, ["quantum widgetry"]);
  assert.equal(
    [...p.excludeRoles, ...p.excludeStacks, ...p.excludeDomains].length,
    1,
    "it appears exactly once, not on every axis",
  );
});

// The split is a read-path migration, so it runs until a save persists the result. It must be
// deterministic in the meantime — a profile that reads differently on two calls would make the
// preference era boundary meaningless.
test("re-reading a legacy profile gives the same split", () => {
  legacy(["mobile (iOS / Android)", "crypto"]);
  assert.deepEqual(getProfile(), getProfile());
});

// The failure mode this guards: migrate → the user deletes a term → save → the legacy key is still
// in the blob → the next read re-splits it and the deleted term comes back.
test("a term removed after migration stays removed", () => {
  legacy(["mobile (iOS / Android)", "crypto"]);
  const migrated = getProfile();
  assert.deepEqual(migrated.excludeDomains, ["crypto"]);

  setProfile({ excludeDomains: [] });
  assert.deepEqual(getProfile().excludeDomains, [], "the deletion sticks");
  assert.deepEqual(getProfile().excludeStacks, ["mobile (iOS / Android)"], "the untouched axis survives");
});

test("saving retires the legacy key from the stored blob", () => {
  legacy(["data engineering"]);
  setProfile({ excludeRoles: ["data engineering", "QA / test"] });
  const stored = JSON.parse(getConfig("profile")!);
  assert.equal("excludeDisciplines" in stored, false, "the dead key is gone");
  assert.deepEqual(stored.excludeRoles, ["data engineering", "QA / test"]);
});

// ── which edits open a preference era ─────────────────────────────────────────────────────────
// An era boundary scopes the eval window (currentEvalSince), so opening one throws away the decision
// history that preceded it. That makes the question "does this edit invalidate my old labels?" load
// bearing, and the answer is NOT "any edit".
//
// The rule is about DIRECTION, not about which field moved: an era opens when the change WIDENS what
// the filter accepts, because that's when an old label stops describing today's filter. A posting
// discarded as `domain: crypto` contradicts a filter that now keeps crypto — but it agrees perfectly
// with one that excludes crypto AND ads. Narrowing is the labels being acted on, not overruled.
//
// Without this, the one-click keyword add would open an era on every discard, and filter precision
// would never reach its 10-decision floor: it would read "not scorable yet" forever.
test("adding an exclusion does not open an era — it codifies a rejection already made", () => {
  setProfile({ excludeStacks: ["iOS"] });
  setProfile({ excludeStacks: ["iOS", "Android"] });
  assert.deepEqual(profileVersions(), [], "neither add opens one — both narrow the filter");
});

test("removing an exclusion opens an era — it overrules the labels made under it", () => {
  setProfile({ excludeStacks: ["iOS", "Android"] });
  const before = profileVersions().length;
  setProfile({ excludeStacks: ["iOS"] });
  assert.equal(profileVersions().length, before + 1);
  assert.deepEqual(profileVersions().at(-1)!.changed, ["excludeStacks"]);
});

// The mirror image, and it has to be the mirror or the rule is arbitrary: for an INCLUDE list,
// growing it is what widens the filter.
test("includeDisciplines is the mirror — adding widens, removing does not", () => {
  setProfile({ includeDisciplines: ["backend", "platform"] });
  const before = profileVersions().length;
  setProfile({ includeDisciplines: ["backend"] });
  assert.equal(profileVersions().length, before, "narrowing the includes agrees with old labels");
  setProfile({ includeDisciplines: ["backend", "mobile"] });
  assert.equal(profileVersions().length, before + 1, "adding a discipline overrules a stack discard");
});

// A free-text preference has no direction to read, so any change is a change of mind.
test("a non-list preference opens an era on any change", () => {
  setProfile({ levelRule: "Staff everywhere" });
  assert.deepEqual(profileVersions().at(-1)!.changed, ["levelRule"]);
});

// Reordering is not a change of mind, and never was.
test("reordering a list opens nothing", () => {
  setProfile({ excludeDomains: ["ads", "crypto / blockchain"] });
  const before = profileVersions().length;
  setProfile({ excludeDomains: ["crypto / blockchain", "ads"] });
  assert.equal(profileVersions().length, before);
});

// The agent reads the whole profile blob, so the axes reach the glance and the fit rubric with no
// extra plumbing — but only if they're actually on the object.
test("the agent's profile carries all three axes", () => {
  setProfile({ excludeRoles: ["SRE"], excludeStacks: ["iOS"], excludeDomains: ["ads"] });
  const p = agentProfile() as Record<string, unknown>;
  assert.deepEqual(p.excludeRoles, ["SRE"]);
  assert.deepEqual(p.excludeStacks, ["iOS"]);
  assert.deepEqual(p.excludeDomains, ["ads"]);
});

// ── the one-click append ──────────────────────────────────────────────────────────────────────
test("addExclusions appends to the named axis and leaves the others alone", () => {
  setProfile({ excludeStacks: ["iOS"], excludeDomains: ["ads"] });
  const p = addExclusions("stack", ["Android"]);
  assert.deepEqual(p.excludeStacks, ["iOS", "Android"]);
  assert.deepEqual(p.excludeDomains, ["ads"]);
});

// A chip clicked twice, or a term the user already typed in another case, must not become two rules
// the agent reads as two separate preferences.
test("appending is case-insensitively de-duplicated", () => {
  setProfile({ excludeStacks: ["iOS"] });
  assert.deepEqual(addExclusions("stack", ["ios", "iOS", "Android"]).excludeStacks, ["iOS", "Android"]);
});

// It is the path a one-click discard-feedback takes, so it must be incapable of removing a term —
// a removal would open a preference era and reset the eval window.
test("appending cannot remove anything, and opens no era", () => {
  setProfile({ excludeStacks: ["iOS", "Android"] });
  const eras = profileVersions().length;
  addExclusions("stack", ["C++"]);
  assert.deepEqual(getProfile().excludeStacks, ["iOS", "Android", "C++"]);
  assert.equal(profileVersions().length, eras, "no era — this codifies a label, it doesn't overrule one");
});

test("appending nothing new is a no-op", () => {
  setProfile({ excludeDomains: ["ads"] });
  assert.deepEqual(addExclusions("domain", ["  ", "ads"]).excludeDomains, ["ads"]);
});

// The wiring the popup depends on: a discard reason names the axis its keyword belongs to, and the
// axis names the profile field. Three of the six reasons are keyword-shaped; the others are not
// (`level` is the ladder map's job, `company` is the watchlist's, `other` says nothing).
test("only the keyword-shaped reasons map to an axis", () => {
  assert.equal(axisForReason("role"), "role");
  assert.equal(axisForReason("stack"), "stack");
  assert.equal(axisForReason("domain"), "domain");
  assert.equal(axisForReason("level"), null);
  assert.equal(axisForReason("company"), null);
  assert.equal(axisForReason("other"), null);
});

test("each axis names a real profile field", () => {
  const p = getProfile() as Record<string, unknown>;
  for (const field of Object.values(EXCLUDE_FIELD)) assert.ok(Array.isArray(p[field]), `${field} exists`);
});
