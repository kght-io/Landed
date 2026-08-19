// The desktop app's folder browser reads the ONE directory the user picked. Its whole job is to
// make that boundary real: a renderer asking for "../.." is asking a question the answer to which
// must be "no", not "here is your home directory". These tests are that boundary.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listDir, type Entry } from "../desktop/src/browse";

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "landed-browse-"));
  fs.mkdirSync(path.join(root, "resume", "acme-corp"), { recursive: true });
  fs.mkdirSync(path.join(root, "interview-prep"), { recursive: true });
  fs.writeFileSync(path.join(root, "resume", "resume-ref.docx"), "x".repeat(120));
  fs.writeFileSync(path.join(root, "resume", "acme-corp", "resume.docx"), "y".repeat(9));
  fs.writeFileSync(path.join(root, ".DS_Store"), "junk");
  return root;
}

const names = (es: Entry[]) => es.map((e) => e.name);

test("lists a directory, folders first then files, each sorted by name", () => {
  const root = fixture();
  assert.deepEqual(names(listDir(root, "")), ["interview-prep", "resume"]);
  // Folders before files makes the tree navigable without reading the `dir` flag on every row.
  assert.deepEqual(names(listDir(root, "resume")), ["acme-corp", "resume-ref.docx"]);
});

test("reports size for files and marks directories", () => {
  const root = fixture();
  const entries = listDir(root, "resume");
  assert.deepEqual(entries.find((e) => e.name === "acme-corp"), { name: "acme-corp", dir: true, bytes: null });
  assert.equal(entries.find((e) => e.name === "resume-ref.docx")?.bytes, 120);
});

test("dotfiles are hidden — .DS_Store is noise, not content", () => {
  const root = fixture();
  assert.equal(names(listDir(root, "")).includes(".DS_Store"), false);
});

test("escaping the chosen folder returns nothing, at any depth or encoding", () => {
  const root = fixture();
  for (const escape of ["..", "../..", "resume/../..", "/etc", "resume/../../../../etc"]) {
    assert.deepEqual(listDir(root, escape), [], escape);
  }
});

test("a path that does not exist is empty rather than a throw", () => {
  const root = fixture();
  assert.deepEqual(listDir(root, "nope/not/here"), []);
  // A file is not a directory; asking to list one is a mistake, not a crash.
  assert.deepEqual(listDir(root, "resume/resume-ref.docx"), []);
});
