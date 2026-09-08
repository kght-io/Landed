import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { reset } from "./helpers";
import { PREP_ROOT } from "@landed/backend/prep/export-context";
import {
  listTranscripts, saveTranscript, transcriptFileName, exportTranscriptsFor,
} from "@landed/backend/prep/transcripts";

beforeEach(() => reset());

const rmPrep = () => fs.rmSync(PREP_ROOT, { recursive: true, force: true });

// The dump filename is what the brief job and the prep chat see in the folder listing, so it should
// say which round it is — the label the user typed — not an opaque counter.
test("the typed title becomes the filename, slugified", () => {
  assert.equal(transcriptFileName("Recruiter screen", []), "recruiter-screen.md");
  assert.equal(transcriptFileName("System Design w/ Platform Lead", []), "system-design-w-platform-lead.md");
  assert.equal(transcriptFileName("  Round 3 — Technical Exercise!  ", []), "round-3-technical-exercise.md");
  assert.equal(transcriptFileName("Café / Onsite (final)", []), "cafe-onsite-final.md");
  assert.equal(transcriptFileName("a___b...c", []), "a-b-c.md", "runs of punctuation collapse to one hyphen");
});

// `name` is the per-company unique key, so a repeat name would UPDATE the stored row — pasting a
// second "Recruiter screen" must not silently overwrite the first call.
test("a repeated title gets a numbered suffix instead of clobbering", () => {
  assert.equal(transcriptFileName("Recruiter screen", ["recruiter-screen.md"]), "recruiter-screen-2.md");
  assert.equal(
    transcriptFileName("Recruiter screen", ["recruiter-screen.md", "recruiter-screen-2.md"]),
    "recruiter-screen-3.md",
  );
  // Case and punctuation differences slugify to the same name, so they collide too.
  assert.equal(transcriptFileName("RECRUITER SCREEN!", ["recruiter-screen.md"]), "recruiter-screen-2.md");
});

// The title is optional in the drawer, and a title of nothing but punctuation slugifies to nothing.
test("a blank or unusable title falls back to the counter", () => {
  assert.equal(transcriptFileName(undefined, []), "transcript-1.md");
  assert.equal(transcriptFileName("   ", ["transcript-1.md"]), "transcript-2.md");
  assert.equal(transcriptFileName("!!! ---", ["transcript-1.md", "transcript-2.md"]), "transcript-3.md");
});

// A pasted title is free text and can be pathological: a path, or an essay.
test("the filename is safe and bounded", () => {
  assert.equal(transcriptFileName("../../etc/passwd", []), "etc-passwd.md");
  const long = transcriptFileName("word ".repeat(60), []);
  assert.ok(long.length <= 64, `capped, got ${long.length}`);
  assert.ok(!long.includes("/") && !long.startsWith("-") && long.endsWith(".md"));
  assert.doesNotMatch(long, /-\.md$/, "the cap doesn't leave a dangling hyphen");
});

test("saving a titled transcript writes it under the titled name", () => {
  rmPrep();
  const file = saveTranscript("pendo", "Interviewer: tell me about yourself.", "Recruiter screen");
  assert.equal(file.name, "recruiter-screen.md");
  assert.ok(fs.existsSync(path.join(PREP_ROOT, "pendo", "transcripts", "recruiter-screen.md")));

  const second = saveTranscript("pendo", "Second call.", "Recruiter screen");
  assert.equal(second.name, "recruiter-screen-2.md", "the first transcript is not overwritten");
  assert.equal(listTranscripts("pendo").length, 2);

  // Untitled still counts, and counts only the numbered ones.
  assert.equal(saveTranscript("pendo", "No label.").name, "transcript-1.md");
});

// Existing rows keep the names they were stored under — the dump is regenerated FROM the rows, so a
// transcript saved before this change (or under a title since edited) never gets renamed on disk.
test("re-dumping keeps each row's stored name", () => {
  rmPrep();
  saveTranscript("pendo", "Old one.", "Recruiter screen");
  // A legacy row, stored under the old numbered scheme.
  const legacy = saveTranscript("pendo", "Legacy call.");
  assert.equal(legacy.name, "transcript-1.md");

  fs.rmSync(path.join(PREP_ROOT, "pendo", "transcripts"), { recursive: true, force: true });
  assert.equal(exportTranscriptsFor("pendo"), 2);
  assert.deepEqual(
    fs.readdirSync(path.join(PREP_ROOT, "pendo", "transcripts")).sort(),
    ["recruiter-screen.md", "transcript-1.md"],
  );
});
