import { eq, lt } from "drizzle-orm";
import { db } from "./db";
import { jobs, threads, threadSteps } from "./db/schema";

// ── the agent thread heartbeat ──
// A "thread" is one the agent session. The Claude Code runner spawns a separate `jobhunt` MCP server
// process per session; that process mints a threadId at boot and tags every call with it
// (x-jobhunt-thread). We record the session here (register/heartbeat) and a per-call trace
// (recordStep). There's no user-facing threads view anymore — the Agents page reads the job ledger
// (AgentMonitor). This survives as an INTERNAL liveness signal: reapStuckJobs (lib/jobs/store.ts)
// uses each thread's lastSeenAt to detect a silent/crashed session fast (~15 min) instead of waiting
// out the 60-min claim lease.

const now = () => new Date().toISOString();

// Drop trace rows older than this on write — the trace is a recent-activity buffer, not an archive.
const STEP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Register (or heartbeat) a thread. Called on the MCP server's `initialize` and bumped on every step.
// Idempotent: first contact sets startedAt; later calls only move lastSeenAt (+ fill a missing label/pid).
export function registerThread(input: { id: string; label?: string | null; pid?: number | null }): void {
  const ts = now();
  const id = input.id.trim();
  if (!id) return;
  const label = input.label?.trim() || null;
  db.insert(threads)
    .values({ id, label, pid: input.pid ?? null, startedAt: ts, lastSeenAt: ts, steps: 0 })
    .onConflictDoUpdate({
      target: threads.id,
      // Don't clobber an existing label/pid with nulls from a bare heartbeat.
      set: { lastSeenAt: ts, ...(label ? { label } : {}), ...(input.pid != null ? { pid: input.pid } : {}) },
    })
    .run();
}

// Record one MCP tool call against a thread + bump the thread heartbeat (lastSeenAt) and step count.
// The heartbeat is what reapStuckJobs reads; the step rows are a rolling, self-pruning trace.
export function recordStep(input: {
  threadId: string;
  tool: string;
  jobId?: string | null;
  ok?: boolean;
  durationMs?: number | null;
  summary?: string | null;
}): void {
  const ts = now();
  const id = input.threadId.trim();
  if (!id) return;
  // Ensure the parent row exists (a step can arrive before any explicit register).
  registerThread({ id });
  db.insert(threadSteps)
    .values({
      threadId: id,
      ts,
      tool: input.tool,
      jobId: input.jobId?.trim() || null,
      ok: input.ok ?? true,
      durationMs: input.durationMs ?? null,
      summary: input.summary?.slice(0, 280) ?? null,
    })
    .run();
  db.update(threads)
    .set({ lastSeenAt: ts, steps: (db.select().from(threads).where(eq(threads.id, id)).get()?.steps ?? 0) + 1 })
    .where(eq(threads.id, id))
    .run();
  // Cheap rolling prune so the trace table can't grow unbounded (indexed by ts).
  db.delete(threadSteps).where(lt(threadSteps.ts, new Date(Date.now() - STEP_RETENTION_MS).toISOString())).run();
}

// Stamp a job with the session that claimed it (called from the claim path with the request's thread
// header). Best-effort: a missing/blank threadId is a no-op, so non-the agent claims are unaffected.
export function stampJobThread(jobId: string, threadId?: string | null): void {
  const tid = threadId?.trim();
  if (!tid || !jobId) return;
  db.update(jobs).set({ threadId: tid }).where(eq(jobs.id, jobId)).run();
}
