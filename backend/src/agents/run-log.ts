import fs from "node:fs";
import path from "node:path";
import { repoPath } from "../paths";

// Decoupled agent runs. Each live run is journaled to disk so it OUTLIVES the hot-reloading dev
// server: the `claude` child is spawned detached with its stdout redirected straight to a log file,
// so a Next recompile (which drops the SSE connection and can restart the node process) no longer
// kills the run. A disconnected client re-tails the same file instead of respawning.
//
// One set of files per agent TYPE (not per session), overwritten at each fresh launch — so the
// on-disk footprint is bounded to at most one journal per type, no cleanup cron required. The
// eraser button removes a type's files outright (see the route's `clear` action).

// The directory holding the per-type run journals. NOT auto-created here (keep this module pure and
// testable); the route calls ensureRunDir() before spawning.
export function runDir(): string {
  return repoPath("data", "agent-runs");
}

export function ensureRunDir(): string {
  const dir = runDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export type RunPaths = {
  log: string; // stream-json (newline-delimited) — claude's stdout
  err: string; // claude's stderr — surfaced only if the run fails
  pid: string; // the live child's pid — lets Stop kill a run across recompiles
};

// Resolve a type's journal paths. The type is sanitised so it can never escape the run dir.
export function runPaths(type: string): RunPaths {
  const safe = type.replace(/[^a-z0-9_-]/gi, "_") || "_";
  const dir = runDir();
  return {
    log: path.join(dir, `${safe}.jsonl`),
    err: path.join(dir, `${safe}.err.log`),
    pid: path.join(dir, `${safe}.pid`),
  };
}

// Split a growing buffer into complete newline-terminated lines, keeping any trailing partial line
// (a half-written frame the tailer hasn't seen the rest of yet) for the next read.
export function splitFrames(buf: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) lines.push(line);
  }
  return { lines, rest: buf };
}

// A run is finished the instant claude emits its `result` line (it exits right after). The tailer
// closes the SSE stream once it sees this.
export function isTerminalLine(line: string): boolean {
  try {
    return (JSON.parse(line) as { type?: unknown }).type === "result";
  } catch {
    return false;
  }
}

// Is `pid` a live process? kill(pid, 0) sends no signal — it just probes: ESRCH ⇒ gone, EPERM ⇒
// alive but not ours (still "alive"). A pid file left behind by a reaped process reads as not-alive.
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// The live pid for a type, or null when there's no run (missing file, or a stale/dead pid).
export function readLivePid(type: string): number | null {
  try {
    const n = parseInt(fs.readFileSync(runPaths(type).pid, "utf8").trim(), 10);
    return isAlive(n) ? n : null;
  } catch {
    return null;
  }
}
