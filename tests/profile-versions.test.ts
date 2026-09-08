import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset } from "./helpers";
import { getProfile, setProfile, profileVersions, currentProfileVersion, profileEraStart } from "@landed/backend/db/profile";

beforeEach(() => reset());

// Preferences drift, and unlike a prompt the profile has never recorded WHEN. A `level` discard made
// while targeting Senior/Staff says the opposite thing once you're targeting Staff/Principal — so
// without an era boundary, old labels quietly become claims about a preference you no longer hold.
test("a profile edit opens a new version", () => {
  setProfile({ levelRule: "Senior at big cos" });
  const first = currentProfileVersion()!;
  assert.equal(first.version, 1);

  setProfile({ levelRule: "Staff at big cos" });
  const second = currentProfileVersion()!;
  assert.equal(second.version, 2, "the change is a new era, not an overwrite");
  assert.notEqual(second.effectiveFrom, first.effectiveFrom);
});

// Not every save is a change of mind. Re-saving the same values shouldn't manufacture an era
// boundary — that would fragment the label history for nothing.
test("saving unchanged values does not open a version", () => {
  setProfile({ levelRule: "Senior at big cos" });
  const before = currentProfileVersion()!;
  setProfile({ levelRule: "Senior at big cos" });
  assert.equal(currentProfileVersion()!.version, before.version);
});

// Only the fields a LABEL depends on. Changing your résumé path or a display preference isn't a
// change of taste, and treating it as one would invalidate labels for no reason.
test("only preference fields open a version", () => {
  setProfile({ levelRule: "Senior at big cos" });
  const before = currentProfileVersion()!.version;
  setProfile({ compFloor: "$300k" });
  assert.ok(currentProfileVersion()!.version > before, "comp is a preference — it counts");
});

test("the history is kept, not replaced", () => {
  setProfile({ levelRule: "a" });
  setProfile({ levelRule: "b" });
  setProfile({ levelRule: "c" });

  const all = profileVersions();
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((v) => v.version), [1, 2, 3]);
  assert.equal(all[0].profile.levelRule, "a", "an old era still says what it believed");
});

// What the eval needs: the date the current preference era began. Labels older than this were made
// under a different set of preferences and can't be scored against today's filter.
test("the era start is the current version's effective date", () => {
  setProfile({ levelRule: "a" });
  setProfile({ levelRule: "b" });
  assert.equal(profileEraStart(), currentProfileVersion()!.effectiveFrom);
});

// A fresh install has no history and must still work — the era is simply "always".
test("an unedited profile reports an era without inventing a version", () => {
  assert.deepEqual(getProfile(), getProfile(), "reads are stable");
  assert.equal(profileVersions().length, 0);
  assert.ok(profileEraStart(), "and there's still a usable era start");
});

// The change itself is the interesting part — "level changed on this date" is a fact you can read,
// which is what a decay curve could never give you.
test("a version records which fields changed", () => {
  setProfile({ levelRule: "a", compFloor: "$300k" });
  setProfile({ levelRule: "b" });
  assert.deepEqual(currentProfileVersion()!.changed, ["levelRule"]);
});
