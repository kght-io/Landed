// The per-company interview-prep chat is a LOCKED-DOWN agent: scoped to one company's folder under
// the interview-prep tree, read-only, no jobhunt tools. These tests pin the two things that keep it
// contained — the path guard (a chat can never be pointed outside interview-prep/) and the launch
// flags (no MCP, no bypass) — plus the context-file listing the UI shows.
import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TEST_DIR } from "./setup";
import { resolvePrepDir, ensurePrepDir, ensurePrepFiles, mdFilesIn, PREP_ROOT } from "@landed/backend/prep/export-context";
import { reset, seedApp } from "./helpers";
import { prepChatArgs, baseArgs } from "@landed/backend/agents/claude-code";

test("resolvePrepDir: a plain slug resolves inside the interview-prep tree", () => {
  const dir = resolvePrepDir("pendo");
  assert.equal(dir, path.join(PREP_ROOT, "pendo"));
  assert.ok(dir!.startsWith(path.resolve(PREP_ROOT) + path.sep));
});

test("resolvePrepDir: traversal / empty slugs are rejected (null), never escape the tree", () => {
  assert.equal(resolvePrepDir("../../etc"), null);
  assert.equal(resolvePrepDir("../resume"), null);
  assert.equal(resolvePrepDir(".."), null);
  assert.equal(resolvePrepDir(""), null); // the root itself is not a company folder
});

test("ensurePrepDir: the folder exists afterwards, even with nothing dumped in it", () => {
  // The chat spawns with cwd = this folder. A cwd that doesn't exist fails as "spawn claude ENOENT" —
  // indistinguishable from a missing binary, and it bit every RESUMED turn, which skips the dump
  // step entirely. So resolving the dir for a chat has to guarantee it.
  const dir = ensurePrepDir("neverdumped");
  assert.equal(dir, path.join(PREP_ROOT, "neverdumped"));
  assert.ok(fs.statSync(dir!).isDirectory(), "the folder is on disk, ready to be a cwd");
  assert.equal(ensurePrepDir("neverdumped"), dir, "idempotent — a second call is fine");
});

test("ensurePrepDir: still refuses to leave the interview-prep tree (and creates nothing)", () => {
  assert.equal(ensurePrepDir("../escape"), null);
  assert.equal(ensurePrepDir(""), null);
  assert.ok(!fs.existsSync(path.join(path.dirname(path.resolve(PREP_ROOT)), "escape")));
});

test("ensurePrepFiles: a RESUMED turn still dumps context.md when the folder is empty", () => {
  // A stored session can outlive its folder (or predate it). Skipping the dump on resume left the
  // coach cwd'd into an empty directory with nothing to read.
  reset();
  seedApp({ company: "Pendo", role: "Staff Software Engineer", status: "interview" });
  const ctx = path.join(PREP_ROOT, "pendo", "context.md");
  fs.rmSync(path.join(PREP_ROOT, "pendo"), { recursive: true, force: true });

  ensurePrepFiles("pendo", { resumed: true });
  assert.ok(fs.existsSync(ctx), "context.md is dumped even mid-conversation");
});

test("ensurePrepFiles: a NEW session re-dumps context.md, so nobody has to press a button", () => {
  // The dump is a render of the DB. Leaving it to a manual click is how a chat ends up coaching from
  // a stale digest while the tracker has moved on — so opening a conversation refreshes it.
  reset();
  seedApp({ company: "Pendo", role: "Staff Software Engineer", status: "interview" });
  const ctx = path.join(PREP_ROOT, "pendo", "context.md");
  ensurePrepFiles("pendo");
  fs.writeFileSync(ctx, "# stale — written by hand\n");

  ensurePrepFiles("pendo"); // a new session, not a resume
  const after = fs.readFileSync(ctx, "utf8");
  assert.ok(!after.includes("stale — written by hand"), "the dump was regenerated, not left alone");
  assert.ok(after.includes("Pendo"), "…and it is the real DB dump");
});

test("mdFilesIn: lists only .md files, newest first; missing dir is empty", () => {
  const dir = fs.mkdtempSync(path.join(TEST_DIR, "prepfiles-"));
  fs.writeFileSync(path.join(dir, "context.md"), "# ctx");
  fs.writeFileSync(path.join(dir, "questions.md"), "# qs");
  fs.writeFileSync(path.join(dir, "notes.txt"), "ignore me");
  fs.mkdirSync(path.join(dir, "transcripts"));
  // Force a deterministic mtime ordering: questions.md newer than context.md.
  const older = new Date("2026-01-01T00:00:00.000Z");
  const newer = new Date("2026-02-01T00:00:00.000Z");
  fs.utimesSync(path.join(dir, "context.md"), older, older);
  fs.utimesSync(path.join(dir, "questions.md"), newer, newer);

  const files = mdFilesIn(dir);
  assert.deepEqual(files.map((f) => f.name), ["questions.md", "context.md"]);
  assert.ok(files.every((f) => f.size > 0 && typeof f.mtime === "string"));

  assert.deepEqual(mdFilesIn(path.join(dir, "does-not-exist")), []);
});

test("prepChatArgs: locked down — read-only tools, bounded dir, and NO full-agent powers", () => {
  const args = prepChatArgs(PREP_ROOT);
  assert.ok(args.includes("--add-dir"));
  assert.equal(args[args.indexOf("--add-dir") + 1], PREP_ROOT);
  // Read-only file tools + web lookup only — a coach that can look things up but not act.
  const tools = args[args.indexOf("--allowedTools") + 1].split(",");
  assert.deepEqual(tools, ["Read", "Glob", "Grep", "WebSearch", "WebFetch"]);
  assert.ok(!tools.includes("Write") && !tools.includes("Edit") && !tools.includes("Bash"), "no tools that act / mutate");
  // The whole point of the lockdown: none of the full-agent flags leak in.
  assert.ok(!args.includes("--mcp-config"), "prep chat must not load the jobhunt MCP server");
  assert.ok(!args.includes("--permission-mode"), "prep chat must not bypass permissions");
  assert.ok(!args.includes("bypassPermissions"));
});

test("baseArgs still carries the full-agent powers (drain runner / general chat) — unchanged", () => {
  const args = baseArgs("/tmp/mcp.json");
  assert.ok(args.includes("--mcp-config"));
  assert.ok(args.includes("bypassPermissions"));
});
