import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isExcludedTitle } from "@landed/shared/jobs/exclude";

// The shared non-engineering floor. Applied by the app's api scan AND re-enforced server-side on
// every glance submission, so every fetch method gets the same treatment.

test("leadership titles are dropped — this is an IC search", () => {
  assert.equal(isExcludedTitle("Engineering Manager, Platform"), true);
  assert.equal(isExcludedTitle("Director of Engineering"), true);
  // "Head of X" carried neither `manager` nor `director`, so it sailed through: a real scan surfaced
  // "Head of Music" for triage. Same job family, different noun.
  assert.equal(isExcludedTitle("Head of Music"), true);
  assert.equal(isExcludedTitle("Head of Engineering"), true);
  assert.equal(isExcludedTitle("Head of Infrastructure"), true);
});

// The reason this is a phrase and not the bare word: dropping anything containing "head" would take
// real IC roles with it. `overhead`, `headless`, and `Headcount Platform` are all engineering work.
test("the word 'head' inside an IC title is not a leadership signal", () => {
  assert.equal(isExcludedTitle("Senior Software Engineer, Headless Commerce"), false);
  assert.equal(isExcludedTitle("Staff Engineer, Headcount Platform"), false);
  assert.equal(isExcludedTitle("Software Engineer, Overhead Reduction"), false);
});

// Regression floor: the families that were already covered must stay covered.
test("the existing non-engineering families still drop", () => {
  assert.equal(isExcludedTitle("Enterprise Sales Engineer"), true);
  assert.equal(isExcludedTitle("Technical Program Manager"), true);
  assert.equal(isExcludedTitle("Senior Product Marketing Manager"), true);
  assert.equal(isExcludedTitle("Software Engineer Intern"), true);
});

test("ordinary IC engineering titles survive", () => {
  assert.equal(isExcludedTitle("Staff Software Engineer, Build (Bazel)"), false);
  assert.equal(isExcludedTitle("Senior Backend Engineer"), false);
  assert.equal(isExcludedTitle("Member of Technical Staff"), false);
  // Department is part of the haystack, so an engineering dept must not itself trip the filter.
  assert.equal(isExcludedTitle("Software Engineer, Payments", "Engineering"), false);
});
