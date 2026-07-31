import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { safeName, dedupeName, saveAttachments, listAttachments, attachmentsDir } from "@landed/core/prep/attachments";

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
