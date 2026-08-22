// The repo-root .env has to load no matter what the cwd is.
//
// The bug this encodes: `npm run dev` runs the frontend workspace script, so npm sets cwd to
// frontend/. Next's dotenv loader is cwd-relative, so it looked for frontend/.env — which does not
// exist — and the repo-root .env was never read. ASSET_ROOT therefore fell back to the empty
// repo-local asset-root folder while the user's real assets (119 résumé versions) lived at the path
// .env actually specifies. The app ran on the wrong root for months; the tailoring agent only got
// the right one because it grepped .env itself on every run. Then getContext started handing that
// wrong path over as authoritative, and the agent — correctly trusting it — was sent to a folder
// with no base résumé in it.
//
// Same class of bug as the cwd-relative data/jobhunt.db trap in AGENTS.md: anchor on REPO_ROOT,
// never on cwd.
import "./setup";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadEnvFile } from "@landed/backend/env";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "env-test-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (body: string): string => {
  const p = path.join(dir, ".env");
  fs.writeFileSync(p, body);
  return p;
};

test("fills variables that aren't already set", () => {
  const env: Record<string, string | undefined> = {};
  loadEnvFile(write("ASSET_ROOT=/Users/me/Job-Hunt-App\nJOBHUNT_URL=http://localhost:3000\n"), env);
  assert.equal(env.ASSET_ROOT, "/Users/me/Job-Hunt-App");
  assert.equal(env.JOBHUNT_URL, "http://localhost:3000");
});

// The precedence that keeps the test suite safe: tests/setup.ts points ASSET_ROOT at a throwaway
// temp dir BEFORE backend modules load. If loading .env clobbered that, every test would run
// against the real résumé folder — reading, and potentially writing, live user data.
test("never overrides a variable the process already has — real env beats .env", () => {
  const env: Record<string, string | undefined> = { ASSET_ROOT: "/tmp/throwaway" };
  loadEnvFile(write("ASSET_ROOT=/Users/me/Job-Hunt-App\n"), env);
  assert.equal(env.ASSET_ROOT, "/tmp/throwaway", "an explicitly-set var wins");
});

// A fresh clone has no .env at all (ASSET_ROOT then falls back to the repo-local folder by design).
test("a missing .env is a silent no-op, not a crash", () => {
  const env: Record<string, string | undefined> = {};
  assert.doesNotThrow(() => loadEnvFile(path.join(dir, "nope.env"), env));
  assert.deepEqual(env, {});
});

test("skips comments and blank lines, and strips surrounding quotes", () => {
  const env: Record<string, string | undefined> = {};
  loadEnvFile(write(`# a comment\n\nASSET_ROOT="/Users/me/My Folder"\n  # indented comment\nTOKEN='abc123'\n`), env);
  assert.equal(env.ASSET_ROOT, "/Users/me/My Folder", "quoted values keep their spaces, lose their quotes");
  assert.equal(env.TOKEN, "abc123");
  assert.equal(Object.keys(env).length, 2, "comments and blanks contribute nothing");
});

// Values legitimately contain '=' (connection strings, base64 secrets) — only the first one splits.
test("splits on the first = only", () => {
  const env: Record<string, string | undefined> = {};
  loadEnvFile(write("CF_ACCESS_CLIENT_SECRET=a=b=c\n"), env);
  assert.equal(env.CF_ACCESS_CLIENT_SECRET, "a=b=c");
});

// The payoff: importing config must not depend on where the process was launched from. setup.ts
// sets ASSET_ROOT, so config keeps the temp dir — proving the load ran without hijacking the suite.
test("config resolves ASSET_ROOT without depending on cwd", async () => {
  const { ASSET_ROOT } = await import("@landed/backend/config");
  assert.equal(ASSET_ROOT, process.env.ASSET_ROOT, "the test's temp root survived the .env load");
  assert.ok(ASSET_ROOT && ASSET_ROOT.startsWith("/"), "and it's absolute");
});
