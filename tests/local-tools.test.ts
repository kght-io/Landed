// The tools the desktop app exposes to the agent over a LOCAL MCP server.
//
// mcp/jobhunt-server.mjs stays what it is — a zero-dependency HTTP client that never touches disk
// and never opens the DB. These are the other half: the machine. Keeping them in separate servers
// is what lets the data half point at the cloud while the file half stays where the files are.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { buildTailoredResume, readBaseResumeText } from "../desktop/src/local-tools";

const DOC_XML =
  `<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t xml:space="preserve">Recently built a 0</w:t></w:r>` +
  `<w:r><w:t>→</w:t></w:r><w:r><w:t xml:space="preserve">1 full-stack product.</w:t></w:r></w:p></w:body></w:document>`;

function root(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "landed-tools-"));
  fs.mkdirSync(path.join(dir, "resume"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "resume", "resume-ref.docx"),
    zipSync({ "word/document.xml": strToU8(DOC_XML), "word/styles.xml": strToU8("<w:styles/>") }),
  );
  return dir;
}

const EDIT = [{ find: "0→1 full-stack product.", replace: "0→1 ML product." }];

test("reads the base résumé as visible text, so the agent edits what a human sees", () => {
  assert.equal(readBaseResumeText(root()), "Recently built a 0→1 full-stack product.");
});

test("writes the tailored résumé into resume/<slug>/", () => {
  const r = root();
  const res = buildTailoredResume(r, "acme-corp", EDIT);
  assert.equal(res.ok, true);
  assert.equal(fs.existsSync(path.join(r, "resume", "acme-corp", "resume.docx")), true);
});

test("re-tailoring replaces the file with a FRESH inode, never writing in place", () => {
  // ASSET_ROOT is typically a cloud-synced folder (iCloud, Dropbox). Overwriting a file in place
  // there has corrupted résumés before: the sync client is reading the same inode as it is being
  // rewritten. Writing a new file and renaming over the old one sidesteps that entirely, so the
  // inode changing is the actual contract — not an implementation detail.
  const r = root();
  buildTailoredResume(r, "acme-corp", EDIT);
  const target = path.join(r, "resume", "acme-corp", "resume.docx");
  const before = fs.statSync(target).ino;

  buildTailoredResume(r, "acme-corp", [{ find: "0→1 full-stack product.", replace: "0→1 infra product." }]);
  assert.notEqual(fs.statSync(target).ino, before);
});

test("an unmatched find leaves the previous résumé untouched", () => {
  const r = root();
  buildTailoredResume(r, "acme-corp", EDIT);
  const target = path.join(r, "resume", "acme-corp", "resume.docx");
  const before = fs.readFileSync(target);

  const res = buildTailoredResume(r, "acme-corp", [{ find: "not in the resume", replace: "x" }]);
  assert.equal(res.ok, false);
  assert.deepEqual(res.missed, ["not in the resume"]);
  assert.deepEqual(fs.readFileSync(target), before); // the good one survives a bad run
});

test("a slug that is not a slug is refused before anything touches disk", () => {
  const r = root();
  for (const bad of ["../escape", "a/b", "", ".", "UPPER"]) {
    const res = buildTailoredResume(r, bad, EDIT);
    assert.equal(res.ok, false, bad);
    assert.match(res.error ?? "", /slug/i, bad);
  }
});
