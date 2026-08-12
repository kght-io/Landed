#!/usr/bin/env node
// Does the built app actually boot, open a database, and serve a route?
//
// Every test in tests/ is pure — they exercise logic against a temp DB that the test process itself
// opened. None of them start a server, so none of them would notice a production build that can't
// boot: a broken server/client boundary, a native module that didn't load, a schema bootstrap that
// throws on an empty volume. That last one is the exact first-deploy path on a fresh Fly volume.
//
// So this boots `next start` for real, against an EMPTY temp database, and asserts two things:
//   /api/health  → the process is up and the schema built itself from nothing
//   /api/jobs    → the real query layer runs and serialises (not just the probe)
//
// Requires `npm run build` to have run first. Plain node, no dependencies — same as backup-db.mjs.

import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOOT_TIMEOUT_MS = 60_000;
const POLL_MS = 500;

function die(msg) {
  console.error(`✖ smoke: ${msg}`);
  process.exit(1);
}

// Ask the OS for a free port rather than guessing one — CI runners and a dev machine with the app
// already running on :3000 both make a hardcoded port a coin flip.
async function freePort() {
  const srv = net.createServer();
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  const { port } = srv.address();
  await new Promise((res) => srv.close(res));
  return port;
}

if (!fs.existsSync(path.join(REPO, "frontend", ".next"))) {
  die("frontend/.next is missing — run `npm run build` first");
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "landed-smoke-"));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;

// A throwaway database and asset root. The DB file does not exist yet — proving it gets created and
// fully bootstrapped is the point, not an incidental detail.
const child = spawn("npm", ["start"], {
  cwd: REPO,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    DB_PATH: path.join(tmp, "smoke.db"),
    ASSET_ROOT: path.join(tmp, "asset-root"),
  },
  detached: true, // own process group, so the whole `npm → next` tree dies with one kill
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
child.stdout.on("data", (d) => (serverLog += d));
child.stderr.on("data", (d) => (serverLog += d));

let exited = null;
child.on("exit", (code, signal) => (exited = signal ? `signal ${signal}` : `code ${code}`));

function cleanup() {
  try {
    process.kill(-child.pid, "SIGKILL"); // negative pid = the group
  } catch {
    /* already gone */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

function fail(msg) {
  cleanup();
  console.error(`\n─── server output ───\n${serverLog.trim() || "(none)"}\n─────────────────────`);
  die(msg);
}

async function get(pathname) {
  const res = await fetch(`${base}${pathname}`);
  const body = await res.text();
  return { status: res.status, body };
}

// ── boot ────────────────────────────────────────────────────────────────────────────────────────
const deadline = Date.now() + BOOT_TIMEOUT_MS;
let health = null;
while (Date.now() < deadline) {
  if (exited) fail(`server exited before it answered (${exited})`);
  try {
    const res = await get("/api/health");
    // 503 is a real answer from a booted server — stop polling and let the assertions report why.
    if (res.status === 200 || res.status === 503) {
      health = res;
      break;
    }
  } catch {
    /* connection refused — still starting */
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
if (!health) fail(`no answer from ${base}/api/health within ${BOOT_TIMEOUT_MS / 1000}s`);

// ── assertions ──────────────────────────────────────────────────────────────────────────────────
let report;
try {
  report = JSON.parse(health.body);
} catch {
  fail(`/api/health returned non-JSON: ${health.body.slice(0, 200)}`);
}

if (health.status !== 200 || !report.ok) {
  fail(`/api/health says unhealthy (${health.status}): ${JSON.stringify(report.db)}`);
}
if (report.db.missingTables.length) {
  fail(`schema did not bootstrap on an empty DB — missing: ${report.db.missingTables.join(", ")}`);
}
console.log(`✓ boots and bootstraps an empty DB (schema v${report.db.schemaVersion})`);

const jobs = await get("/api/jobs");
if (jobs.status !== 200) fail(`/api/jobs returned ${jobs.status}`);
try {
  JSON.parse(jobs.body);
} catch {
  fail(`/api/jobs returned non-JSON: ${jobs.body.slice(0, 200)}`);
}
console.log("✓ serves a real query route");

cleanup();
console.log("✓ smoke passed");
