import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { safeName, dedupeName, saveAttachments, listAttachments, listAttachmentFiles, resolveAttachment, attachmentsDir } from "@landed/backend/prep/attachments";
import { fmtBytes } from "@landed/shared/format/bytes";

test("safeName strips directories, path separators, and control chars — keeps the extension", () => {
  assert.equal(safeName("../../etc/passwd"), "passwd");
  assert.equal(safeName("role.pdf"), "role.pdf"); // dot kept
  assert.equal(safeName("a\\b.pdf"), "ab.pdf"); // backslash stripped (not a posix separator)
  assert.equal(safeName(""), "attachment"); // empty → fallback
  assert.equal(safeName("   "), "attachment"); // whitespace-only → fallback
});

test("dedupeName inserts a numeric suffix before the extension on collision", () => {
  assert.equal(dedupeName([], "role.pdf"), "role.pdf");
  assert.equal(dedupeName(["role.pdf"], "role.pdf"), "role-1.pdf");
  assert.equal(dedupeName(["role.pdf", "role-1.pdf"], "role.pdf"), "role-2.pdf");
  assert.equal(dedupeName(["notes"], "notes"), "notes-1"); // no extension
});

test("saveAttachments writes buffers, de-dupes across the batch, and lists them back", () => {
  const slug = "acme-test";
  const saved = saveAttachments(slug, [
    { filename: "role.pdf", content: Buffer.from("aaa") },
    { filename: "role.pdf", content: Buffer.from("bbbb") }, // same name → deduped
    { filename: "../evil/take-home.md", content: Buffer.from("cc") }, // path stripped
  ]);
  assert.deepEqual(saved.map((s) => s.name), ["role.pdf", "role-1.pdf", "take-home.md"]);
  assert.equal(saved[1].bytes, 4);

  const dir = attachmentsDir(slug);
  assert.equal(fs.readFileSync(path.join(dir, "role.pdf"), "utf8"), "aaa");
  assert.equal(fs.readFileSync(path.join(dir, "role-1.pdf"), "utf8"), "bbbb");
  assert.deepEqual(listAttachments(slug).sort(), ["role-1.pdf", "role.pdf", "take-home.md"]);
});

test("saveAttachments on an empty batch is a no-op; listAttachments tolerates a missing folder", () => {
  assert.deepEqual(saveAttachments("nobody", []), []);
  assert.deepEqual(listAttachments("never-created"), []);
});

test("a size reads at a glance — precision only where it means something", () => {
  assert.equal(fmtBytes(0), "0 B");
  assert.equal(fmtBytes(1023), "1023 B");
  assert.equal(fmtBytes(1024), "1.0 KB");
  assert.equal(fmtBytes(4 * 1024 * 1024), "4.0 MB", "not 4096 KB");
  assert.equal(fmtBytes(512 * 1024 * 1024), "512 MB", "past 10 the decimal is noise");
});

test("listAttachmentFiles reports sizes, name-sorted", () => {
  const slug = "sizes-test";
  saveAttachments(slug, [
    { filename: "prep-guide.pdf", content: Buffer.from("aaa") },
    { filename: "brief.pdf", content: Buffer.from("bb") },
  ]);
  assert.deepEqual(listAttachmentFiles(slug), [
    { name: "brief.pdf", bytes: 2 },
    { name: "prep-guide.pdf", bytes: 3 },
  ]);
  assert.deepEqual(listAttachmentFiles("never-created"), []);
});

// The serve route takes the filename straight off the URL, so the guard is the whole security story.
test("resolveAttachment serves only a real file named exactly as it was saved", () => {
  const slug = "serve-test";
  saveAttachments(slug, [{ filename: "take-home.pdf", content: Buffer.from("x") }]);

  assert.equal(resolveAttachment(slug, "take-home.pdf"), path.join(attachmentsDir(slug), "take-home.pdf"));
  assert.equal(resolveAttachment(slug, "missing.pdf"), null, "a name with no file behind it");
  assert.equal(resolveAttachment(slug, ""), null);
  assert.equal(resolveAttachment(slug, "../../../etc/passwd"), null, "traversal");
  assert.equal(resolveAttachment(slug, "sub/take-home.pdf"), null, "separators never survive safeName");
  assert.equal(resolveAttachment(slug, ".."), null);
});
