import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isExcludedTitle } from "@landed/shared/jobs/exclude";
import { DEFAULT_PROFILE } from "@landed/backend/db/profile";

// The non-engineering floor, run against the profile's DEFAULT title terms. The terms moved out of a
// hardcoded regex into the profile; these are the regression floor proving the defaults a fresh
// install gets still drop exactly what the regex did. Applied by the api scan AND re-enforced on
// every glance submission.
const excluded = (title: string, department?: string) =>
  isExcludedTitle(title, department, DEFAULT_PROFILE.excludeTitleTerms);

test("leadership titles are dropped — this is an IC search", () => {
  assert.equal(excluded("Engineering Manager, Platform"), true);
  assert.equal(excluded("Director of Engineering"), true);
  // "Head of X" carried neither `manager` nor `director`, so it sailed through: a real scan surfaced
  // "Head of Music" for triage. Same job family, different noun.
  assert.equal(excluded("Head of Music"), true);
  assert.equal(excluded("Head of Engineering"), true);
  assert.equal(excluded("Head of Infrastructure"), true);
});

// The reason this is a phrase and not the bare word: dropping anything containing "head" would take
// real IC roles with it. `overhead`, `headless`, and `Headcount Platform` are all engineering work.
test("the word 'head' inside an IC title is not a leadership signal", () => {
  assert.equal(excluded("Senior Software Engineer, Headless Commerce"), false);
  assert.equal(excluded("Staff Engineer, Headcount Platform"), false);
  assert.equal(excluded("Software Engineer, Overhead Reduction"), false);
});

// Regression floor: the families that were already covered must stay covered.
test("the existing non-engineering families still drop", () => {
  assert.equal(excluded("Enterprise Sales Engineer"), true);
  assert.equal(excluded("Technical Program Manager"), true);
  assert.equal(excluded("Senior Product Marketing Manager"), true);
  assert.equal(excluded("Software Engineer Intern"), true);
  // The three the regex spelled with syntax rather than words: a stem, an optional space, a hyphen.
  assert.equal(excluded("Technical Recruiter"), true);
  assert.equal(excluded("IT Helpdesk Technician"), true);
  assert.equal(excluded("Go-to-Market Engineer"), true);
  assert.equal(excluded("Data Center Operations Engineer"), true);
});

test("ordinary IC engineering titles survive", () => {
  assert.equal(excluded("Staff Software Engineer, Build (Bazel)"), false);
  assert.equal(excluded("Senior Backend Engineer"), false);
  assert.equal(excluded("Member of Technical Staff"), false);
  // Department is part of the haystack, so an engineering dept must not itself trip the filter.
  assert.equal(excluded("Software Engineer, Payments", "Engineering"), false);
});

// The list is the whole filter. With no terms nothing is dropped — there is no floor hiding in code.
test("an empty term list excludes nothing", () => {
  assert.equal(isExcludedTitle("Enterprise Sales Engineer", null, []), false);
});
