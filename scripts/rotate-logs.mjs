#!/usr/bin/env node
// Rotate the launchd service logs. Run by com.kaung.jobhunt.logrotate (hourly); safe to run by
// hand: `npm run logs:rotate`. Add --force to rotate regardless of size, --dry-run to just look.
//
// COPY-TRUNCATE, deliberately: launchd holds an open fd on the live log (StandardOutPath), so a
// rename would leave `next dev` writing into an orphaned inode — the file would look rotated while
// the disk kept filling. Truncating in place keeps that fd valid.
//
// The decision logic (thresholds, generation shuffle) lives in backend/src/logs/rotate.ts so
// it can be tested without touching the filesystem; this file is only the mechanics.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Mirror of backend/src/logs/rotate.ts — kept literal so this script stays dependency-free
// (it runs from launchd with a bare PATH and no tsx). tests/log-rotate.test.ts covers the source.
const THRESHOLD = 20_000_000;
const KEEP = 3;
const TARGETS = ["data/launchd-jobhunt.out.log", "data/launchd-jobhunt.err.log"];

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
const log = (m) => console.log(`[logrotate ${new Date().toISOString()}] ${m}`);

function planShifts(base, existing, keep) {
  const gen = (n) => `${base}.${n}.gz`;
  const present = new Set();
  for (const name of existing) {
    if (!name.startsWith(`${base}.`) || !name.endsWith(".gz")) continue;
    const middle = name.slice(base.length + 1, -".gz".length);
    if (!/^\d+$/.test(middle)) continue;
    present.add(Number(middle));
  }
  const shifts = [];
  const deletes = [];
  for (let n = keep; n >= 1; n--) {
    if (!present.has(n)) continue;
    if (n >= keep) deletes.push(gen(n));
    else shifts.push({ from: gen(n), to: gen(n + 1) });
  }
  shifts.push({ from: base, to: gen(1) });
  return { shifts, deletes };
}

const mb = (n) => `${(n / 1_000_000).toFixed(1)} MB`;

for (const rel of TARGETS) {
  const full = path.join(REPO_ROOT, rel);
  let size;
  try {
    size = fs.statSync(full).size;
  } catch {
    continue; // never started, or already cleaned up — nothing to do
  }
  if (size < THRESHOLD && !force) continue;

  // Caddy's logs are root-owned; anything we can't write, we report rather than crash on.
  try {
    fs.accessSync(full, fs.constants.W_OK);
  } catch {
    log(`skip ${rel} (${mb(size)}) — not writable by this user`);
    continue;
  }

  const dir = path.dirname(full);
  const baseName = path.basename(full);
  const existing = fs.readdirSync(dir);
  const { shifts, deletes } = planShifts(baseName, existing, KEEP);

  if (dryRun) {
    log(`would rotate ${rel} (${mb(size)}): ${shifts.map((s) => `${s.from}→${s.to}`).join(", ")}${deletes.length ? ` · drop ${deletes.join(", ")}` : ""}`);
    continue;
  }

  for (const name of deletes) fs.rmSync(path.join(dir, name), { force: true });
  for (const { from, to } of shifts) {
    const src = path.join(dir, from);
    const dest = path.join(dir, to);
    if (from === baseName) {
      // The live log: gzip a COPY, then truncate the original in place so launchd's fd survives.
      fs.writeFileSync(dest, zlib.gzipSync(fs.readFileSync(src)));
      fs.truncateSync(src, 0);
    } else {
      fs.renameSync(src, dest); // already-rotated generations are ours alone to move
    }
  }
  log(`rotated ${rel} (${mb(size)} → ${baseName}.1.gz); keeping ${KEEP} generations`);
}
