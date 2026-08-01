import test from "node:test";
import assert from "node:assert/strict";
import { describeChange, describeChanges } from "@landed/shared/format/change";

const text = (d: Parameters<typeof describeChange>[0]) => describeChange(d).text;

test("a stage move reads as plain English, with the pipeline's own stage names", () => {
  const d = describeChange({ field: "status", old: "applied", new: "interview" });
  assert.equal(d.label, "Stage");
  assert.equal(d.from, "Applied");
  assert.equal(d.to, "Interviewing");
  assert.equal(d.text, "Stage: Applied → Interviewing");
});

test("setting a field that was empty reads as 'set to', not '∅ →'", () => {
  assert.equal(text({ field: "appliedDate", new: "2026-06-25" }), "Applied date: set to 2026-06-25");
  assert.equal(text({ field: "location", new: "New York, NY" }), "Location: set to New York, NY");
});

test("clearing a field reads as 'cleared'", () => {
  assert.equal(text({ field: "team", old: "Ads" }), "Team: cleared (was Ads)");
});

test("interview rounds and the interviewed flag get their own phrasing", () => {
  assert.equal(text({ field: "interviews", new: "2 rounds" }), "Adds 2 interview rounds");
  assert.equal(text({ field: "interviews", new: "1 round" }), "Adds 1 interview round");
  assert.equal(text({ field: "interviewed", old: "no", new: "yes" }), "Marked as interviewed");
});

test("an unknown field still renders readably rather than leaking the column name", () => {
  assert.equal(text({ field: "fitScore", old: "3", new: "4" }), "Fit score: 3 → 4");
  assert.equal(text({ field: "atsId", new: "abc" }), "Ats id: set to abc");
});

test("a long value is kept intact — the UI truncates, the text doesn't lie", () => {
  const long = "x".repeat(300);
  assert.equal(text({ field: "note", new: long }), `Note: set to ${long}`);
});

test("describeChanges maps a whole diff list in order", () => {
  const out = describeChanges([
    { field: "status", old: "applied", new: "interview" },
    { field: "interviews", new: "2 rounds" },
  ]);
  assert.deepEqual(out.map((d) => d.text), ["Stage: Applied → Interviewing", "Adds 2 interview rounds"]);
});
