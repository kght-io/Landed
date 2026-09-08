import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { safeUploadName, savePrepUpload, listPrepUploads, MAX_UPLOAD_BYTES } from "@landed/backend/prep/uploads";
import { PREP_ROOT } from "@landed/backend/prep/root";
import { withAttachments } from "@landed/shared/prep/chat-store";
import { UPLOAD_ACCEPT, isImageAttachment } from "@landed/shared/prep/attachments";

// Attachments land in the company's prep folder and the chat then tells the agent to Read them. The
// folder is the agent's cwd and the ONE directory it's allowed to touch, so the filename is the
// whole security boundary: anything that escapes <PREP_ROOT>/<slug>/uploads/ hands a read-only agent
// a path it was never scoped to.

const bytes = (s: string) => Buffer.from(s);
const fresh = (slug: string) => {
  fs.rmSync(path.join(PREP_ROOT, slug), { recursive: true, force: true });
  return slug;
};

test("an ordinary filename is kept as-is", () => {
  assert.equal(safeUploadName("screenshot.png"), "screenshot.png");
  assert.equal(safeUploadName("Take Home Brief v2.pdf"), "Take-Home-Brief-v2.pdf");
});

test("directory components are stripped, not escaped", () => {
  assert.equal(safeUploadName("../../../etc/passwd"), "passwd");
  assert.equal(safeUploadName("/absolute/path/notes.md"), "notes.md");
  assert.equal(safeUploadName("..\\..\\windows\\evil.png"), "evil.png");
});

test("a name that is nothing but separators falls back rather than producing an empty path", () => {
  assert.notEqual(safeUploadName("../../.."), "");
  assert.notEqual(safeUploadName(""), "");
  assert.ok(!safeUploadName("../../..").includes("/"));
});

test("the extension survives sanitizing — it is how the agent knows what it is reading", () => {
  assert.ok(safeUploadName("my résumé (final!).pdf").endsWith(".pdf"));
  assert.ok(safeUploadName("a b c.PNG").toLowerCase().endsWith(".png"));
});

test("an upload lands inside the company's uploads folder", async () => {
  const slug = fresh("figma");
  const saved = await savePrepUpload(slug, "shot.png", bytes("fake-png"));
  const full = path.join(PREP_ROOT, slug, "uploads", saved.name);
  assert.ok(fs.existsSync(full), "file written");
  // The path handed to the agent is relative to its cwd (the company folder), so it can Read it.
  assert.equal(saved.relPath, `uploads/${saved.name}`);
});

// Never clobber: two screenshots both called "Screenshot.png" are two different attachments, and
// silently overwriting the first loses a file the user believes they sent.
test("a second upload with the same name does not overwrite the first", async () => {
  const slug = fresh("stripe");
  const a = await savePrepUpload(slug, "shot.png", bytes("first"));
  const b = await savePrepUpload(slug, "shot.png", bytes("second"));
  assert.notEqual(a.name, b.name);
  const dir = path.join(PREP_ROOT, slug, "uploads");
  assert.equal(fs.readFileSync(path.join(dir, a.name), "utf8"), "first");
  assert.equal(fs.readFileSync(path.join(dir, b.name), "utf8"), "second");
});

test("a traversal filename still writes inside the uploads folder", async () => {
  const slug = fresh("notion");
  const saved = await savePrepUpload(slug, "../../../../escaped.png", bytes("x"));
  const full = path.resolve(path.join(PREP_ROOT, slug, "uploads", saved.name));
  const root = path.resolve(path.join(PREP_ROOT, slug, "uploads"));
  assert.ok(full.startsWith(root + path.sep), "stayed inside uploads/");
});

test("a slug that tries to escape the prep tree is refused", async () => {
  await assert.rejects(() => savePrepUpload("../../..", "a.png", bytes("x")));
  await assert.rejects(() => savePrepUpload("", "a.png", bytes("x")));
});

test("an oversize file is refused rather than filling the synced asset folder", async () => {
  const slug = fresh("linear");
  await assert.rejects(() => savePrepUpload(slug, "big.png", Buffer.alloc(MAX_UPLOAD_BYTES + 1)));
});

// The allowlist is what the agent's Read tool can actually make sense of. A .zip or .exe would be
// dead weight in the folder and a needless thing to have accepted.
test("only file types the agent can read are accepted", async () => {
  const slug = fresh("ramp");
  await assert.rejects(() => savePrepUpload(slug, "payload.zip", bytes("x")));
  await assert.rejects(() => savePrepUpload(slug, "noextension", bytes("x")));
  for (const ok of ["a.png", "a.jpg", "a.pdf", "a.md", "a.txt", "a.csv"])
    await savePrepUpload(slug, ok, bytes("x")); // must not throw
});

// The picker and the server read the SAME list (shared/src/prep/attachments.ts) — this is what that
// buys: nothing can be offered in the file dialog that the upload then turns away.
test("every type the picker offers is one the server accepts", async () => {
  const slug = fresh("offered");
  for (const ext of UPLOAD_ACCEPT) await savePrepUpload(slug, `a${ext}`, bytes("x")); // must not throw
});

test("an attachment's chip icon follows the same list", () => {
  assert.ok(isImageAttachment("Screenshot 2026-09-08.PNG"));
  assert.ok(isImageAttachment("photo.heic"));
  assert.ok(!isImageAttachment("take-home.pdf"));
  assert.ok(!isImageAttachment("png-notes.md")); // the extension, not the name
});

test("uploads are listed newest-first, separately from the research files", async () => {
  const slug = fresh("ro");
  await savePrepUpload(slug, "one.png", bytes("1"));
  await savePrepUpload(slug, "two.png", bytes("2"));
  const list = await listPrepUploads(slug);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((f) => f.name).sort(), list.map((f) => f.name).sort());
  assert.ok(list.every((f) => typeof f.bytes === "number" && f.bytes > 0));
});

test("listing uploads for a company with none is empty, not an error", async () => {
  assert.deepEqual(await listPrepUploads(fresh("never-used")), []);
});

// ── what the agent is actually told ────────────────────────────────────────────────────────────
// The file is already in the agent's cwd by the time a turn runs, so the turn only has to NAME it.

test("a turn with no attachments is sent unchanged", () => {
  assert.equal(withAttachments("what should I ask them?", []), "what should I ask them?");
  assert.equal(withAttachments("  padded  "), "padded");
});

test("attachments are named by their folder-relative path, so the agent can Read them", () => {
  const out = withAttachments("what do you make of this?", [
    { name: "shot.png", relPath: "uploads/shot.png" },
    { name: "brief.pdf", relPath: "uploads/brief.pdf" },
  ]);
  assert.ok(out.startsWith("what do you make of this?"));
  assert.ok(out.includes("uploads/shot.png"));
  assert.ok(out.includes("uploads/brief.pdf"));
  assert.ok(!out.includes(PREP_ROOT), "path stays relative — the agent resolves it against its cwd");
});

// Dragging a screenshot in and hitting send without typing is a normal way to use this.
test("attaching with no message still gives the agent an ask", () => {
  const out = withAttachments("", [{ name: "shot.png", relPath: "uploads/shot.png" }]);
  assert.ok(out.trim().length > "uploads/shot.png".length);
  assert.ok(out.includes("uploads/shot.png"));
});
