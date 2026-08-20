// context.md is the app's own view of a company, rendered for the prep coach to read. These tests
// pin WHAT belongs in it: the tracker knowledge that exists nowhere else on disk, plus the one part
// of an interview brief the coach cannot re-derive — and NOT the parts that are a worse retelling of
// emails.md / transcripts/, which it reads directly.
import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { reset, seedApp, db, postings } from "./helpers";
import { PREP_ROOT, exportPrepContextFor } from "@landed/backend/prep/export-context";

beforeEach(reset);

const brief = {
  version: 2,
  generatedAt: "2026-08-11T10:00:00.000Z",
  role: { text: "Staff Backend Engineer", source: "recruiter" },
  team: { text: "Rewards platform, 8 engineers", source: "online" },
  expectations: { text: "idiomatic, resource-aware code over LeetCode tricks", source: "online" },
  gaps: [
    { area: "Nightly bank-file batch design", why: "research: the onsite design round centers on it", severity: "high", source: "online" },
    { area: "Scala fluency", why: "fit: no Scala on the resume", severity: "medium", source: "online" },
    { area: "Comp expectations", why: "the recruiter asked twice", severity: "low", source: "recruiter" },
  ],
  summary: "Payments-heavy backend.",
};

const dumpFor = (company: string, slug: string): string => {
  const id = seedApp({ company, role: "Backend Engineer", status: "interview" });
  db.update(postings).set({ interviewBriefs: JSON.stringify([brief]) }).where(eq(postings.id, id)).run();
  exportPrepContextFor(slug);
  return fs.readFileSync(path.join(PREP_ROOT, slug, "context.md"), "utf8");
};

test("the brief's ONLINE findings land in the dump — the coach cannot get them from the folder", () => {
  const md = dumpFor("Bilt Rewards", "biltrewards");
  assert.match(md, /Nightly bank-file batch design/, "an online-sourced gap is carried over");
  assert.match(md, /idiomatic, resource-aware code/, "an online-sourced fact is carried over");
  assert.match(md, /v2/, "…attributed to the brief version it came from");
});

test("recruiter- and JD-sourced brief content is NOT copied in — emails and transcripts own that", () => {
  const md = dumpFor("Bilt Rewards", "biltrewards");
  assert.ok(!md.includes("Staff Backend Engineer"), "a recruiter-sourced fact stays in the raw sources");
  assert.ok(!md.includes("the recruiter asked twice"), "a recruiter-sourced gap stays in the raw sources");
});

test("a gap the brief itself credits to the fit assessment is skipped — it is already in this file", () => {
  const md = dumpFor("Bilt Rewards", "biltrewards");
  assert.ok(!md.includes("Scala fluency"), "no restating the fit section back to the reader");
});

test("the retired research profile section is gone", () => {
  const md = dumpFor("Acme", "acme");
  assert.ok(!md.includes("Researched prep profile"), "the fossil section of the retired research job");
});
