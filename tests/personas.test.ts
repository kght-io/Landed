import test from "node:test";
import assert from "node:assert/strict";
import { PERSONA, personaFor } from "@landed/shared/agents/personas";
import { JOB_DEFS } from "@landed/backend/jobs/registry";

// Every registered job type should have a task-descriptive persona — no card should ever fall back
// to the legacy "CoWork" brand as its name. (Regression: interview-brief showed as "CoWork" on the
// Agents page because it was missing from the PERSONA map.)
test("previously-unmapped job types now have proper task personas", () => {
  assert.equal(personaFor("interview-brief"), "Interview Briefer");
  assert.equal(personaFor("interview-emails"), "Interview Scout");
  assert.equal(personaFor("peer-comp"), "Comp Analyst");
});

test("no persona is the legacy 'CoWork' brand", () => {
  for (const name of Object.values(PERSONA)) assert.notEqual(name, "CoWork");
});

test("the fallback prettifies an unknown type instead of naming it 'CoWork'", () => {
  assert.equal(personaFor("some-future-agent"), "Some Future Agent");
  assert.notEqual(personaFor("anything-unmapped"), "CoWork");
});

// Interview Scout is surfaced as an Agents-page card, so its def must not be hidden (the page's
// /api/jobs types list filters out `hidden` defs).
test("interview-emails (Interview Scout) is visible on the Agents page", () => {
  assert.equal(JOB_DEFS["interview-emails"].hidden ?? false, false);
});
