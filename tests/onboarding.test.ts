import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, seedCandidate } from "./helpers";
import { setConfig } from "@landed/backend/db/config-store";
import { onboardingStatus, onboardingComplete } from "@landed/backend/onboarding";

beforeEach(() => reset());

// A fresh install: nothing done yet, so the checklist stays visible. (assetFolder is true here only
// because the test harness points ASSET_ROOT at a real temp dir — see tests/setup.ts.)
test("onboardingStatus reports the un-done steps on an empty install", () => {
  const s = onboardingStatus();
  assert.equal(s.profile, false);
  assert.equal(s.resume, false);
  assert.equal(s.firstJob, false);
  assert.equal(s.assetFolder, true); // the temp ASSET_ROOT exists
  assert.equal(onboardingComplete(s), false);
});

// Saving the profile ticks that step; adding a posting ticks firstJob.
test("saving the profile and adding a posting tick their steps", () => {
  setConfig("profile", JSON.stringify({ level: "Staff" }));
  seedCandidate({ company: "Acme", title: "Senior Software Engineer" });
  const s = onboardingStatus();
  assert.equal(s.profile, true);
  assert.equal(s.firstJob, true);
});

// The essentials gate completion: profile + asset folder + résumé + first job. Résumé needs a real file (not
// present in tests), so completion stays false even with profile + a posting.
test("onboardingComplete requires all three essentials (résumé file absent in tests)", () => {
  setConfig("profile", JSON.stringify({ level: "Staff" }));
  seedCandidate({ company: "Acme", title: "Senior Software Engineer" });
  const s = onboardingStatus();
  assert.equal(s.resume, false);
  assert.equal(onboardingComplete(s), false);
});
