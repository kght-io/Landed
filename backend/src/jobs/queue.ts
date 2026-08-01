import { and, eq, ne, inArray, or, lt, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { jobs, postings, threads } from "../db/schema";
import { getConfig, setConfig, deleteConfig } from "../db/config-store";
import { logEvent } from "../db/queries";
import { jobDef } from "./registry";
import { parseRedoLog, pendingUserIndex } from "@landed/shared/jobs/redolog";
import type { ChangeDetail } from "@landed/shared/agents/types";

// The job queue itself — everything here is TYPE-AGNOSTIC: creating a row, leasing it to an agent,
// reaping an abandoned claim, and ingesting a result. It knows nothing about fit, tailoring, or the
// inbox; where a job type needs a side effect of its own it declares a hook on its JobDef
// (afterIngest / onUnqueue / redoPhase) and this file calls it. Per-type ENQUEUE logic lives in
// ./enqueue/*.

export const now = () => new Date().toISOString();

// A claim is a *lease*, not a permanent lock. An agent flips a job to `wip` before working it; if that
// agent crashes, abandons the run, or stalls, the claim would otherwise pin the job in `wip` forever.
// After the lease expires the job is treated as abandoned: claimable again (claimJob wins against it)
// and surfaced as pending in listings, so the next run reclaims it with no manual step. A `wip` row
// with a null claimedAt (legacy/torn write) counts as stale too, so it can never get stuck.
export const CLAIM_LEASE_MS = 60 * 60 * 1000;
// …but lease-reclaim alone loops a POISON job forever (it fails, expires, re-runs, fails…). So cap it:
// after this many claims with no result, reapStuckJobs() dead-letters it to `failed`. This is the
// reliable, AGENT-INDEPENDENT stuck signal — the app counts claims itself; it never trusts the agent
// to report failure (an LLM agent may crash or silently give up). 3 = one real try + two reclaims.
const CLAIM_MAX_ATTEMPTS = 3;
// The 60-min lease is sized for the SLOWEST job, so it's far too long to notice a fast job's agent
// died. The faster signal is the per-thread HEARTBEAT: the app stamps threads.lastSeenAt on every MCP
// call, so a working agent pings constantly. A `wip` job whose owning thread has been silent this long
// is treated as abandoned and reclaimed — ~minutes instead of an hour. Generous enough to not reclaim
// a healthy job mid-work (an agent can go quiet on us while reasoning / running a Bash scrape).
const HEARTBEAT_SILENCE_MS = 15 * 60 * 1000;
// Exported in the `now`-taking form so the ops view grades a lease exactly the way the queue does —
// two copies of this rule would let the ops page claim work is in flight after listJobs gave up on it.
export const isStaleClaimAt = (status: string, claimedAt: string | null | undefined, now: number): boolean =>
  status === "wip" && (!claimedAt || Date.parse(claimedAt) < now - CLAIM_LEASE_MS);
const isStaleClaim = (status: string, claimedAt?: string | null): boolean =>
  isStaleClaimAt(status, claimedAt, Date.now());
// The SQL form of the lease cutoff: ISO strings are fixed-width UTC, so a text `<` compares correctly.
const claimLeaseCutoff = () => new Date(Date.now() - CLAIM_LEASE_MS).toISOString();

// Legacy job rows used "you"/"app" (You) and "cowork" (CoWork). Normalize to the
// two-actor vocabulary used everywhere else; unknown → assume self-initiated.
export function normCreatedBy(v?: string | null): "You" | "CoWork" {
  return v === "you" || v === "app" || v === "You" ? "You" : "CoWork";
}

// Derive an ISO timestamp from an id like "inbox-sync-20260620T2033" so a synthesized
// job's age in the ledger reflects when the agent ran it, not when we ingested.
function createdAtFromId(id: string): string | null {
  const m = id.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const iso = new Date(`${y}-${mo}-${d}T${h}:${mi}:00`).toISOString();
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export const parseParams = (raw: string | null | undefined): Record<string, unknown> => {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
};

// The posting a fit/tailoring job is a projection of. `params.postings` stays an ARRAY on the wire
// (the playbooks and the agent read it that way), but every path that creates one of these jobs
// writes exactly one entry — the job id is per-posting — so app code reads the first and stops.
const postingIdOf = (raw: string | null | undefined): number | null => {
  const n = Number((parseParams(raw).postings as { id?: unknown }[] | undefined)?.[0]?.id);
  return Number.isFinite(n) ? n : null;
};

export type JobView = {
  id: string;
  type: string;
  createdBy: string;
  createdAt: string;
  status: string;
  claimedAt?: string | null;
  claimedBy?: string | null;
  ingestedAt?: string | null;
  summary?: string | null;
  playbook?: string | null;
  task?: string | null;
  params?: Record<string, unknown>;
  attempts?: number;
  error?: string | null;
};

// The full job ledger + live queue (one table now). Newest first. `queued` rows are pending work
// (app→agent handoffs + the agent self-queued); `wip` rows are claimed/in-flight; `ingested` is history.
export function listJobs(): JobView[] {
  return db
    .select()
    .from(jobs)
    .all()
    .map((r) => ({
      id: r.id, type: r.type, createdBy: normCreatedBy(r.createdBy), createdAt: r.createdAt,
      // A wip row whose lease expired reads back as `queued` — it's up for grabs again (the agent
      // and both queue UIs key off status, so it shows as pending and gets reclaimed/removable).
      status: isStaleClaim(r.status, r.claimedAt) ? "queued" : r.status,
      claimedAt: r.claimedAt, claimedBy: r.claimedBy, ingestedAt: r.ingestedAt,
      summary: r.summary, playbook: r.playbook, task: r.task, params: parseParams(r.params),
      attempts: r.attempts, error: r.error,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// The mechanical stuck-job watchdog — the RELIABLE backbone (never depends on the agent reporting
// anything). Run as a tick on the /api/jobs poll. A `wip` job is ABANDONED when its agent is gone,
// detected two ways (whichever fires first):
//   • heartbeat — its owning thread (agent) hasn't made an MCP call in HEARTBEAT_SILENCE_MS (~min), OR
//   • lease — the 60-min lease expired (the backstop, e.g. a job with no thread).
// (The third signal, "agent moved on to another job", is handled instantly in tryClaim.)
// For each abandoned job: if it's been claimed ≥ CLAIM_MAX_ATTEMPTS with no result it's poison →
// dead-letter to `failed` (shows in "needs attention"); otherwise it still has budget → back to
// `queued` NOW so the next agent reclaims it in minutes, not an hour. Returns how many it actioned.
export function reapStuckJobs(): number {
  const leaseCut = claimLeaseCutoff();
  const beatCut = new Date(Date.now() - HEARTBEAT_SILENCE_MS).toISOString();
  const lastSeen = new Map(db.select({ id: threads.id, seen: threads.lastSeenAt }).from(threads).all().map((t) => [t.id, t.seen]));
  let actioned = 0;
  for (const j of db.select().from(jobs).where(eq(jobs.status, "wip")).all()) {
    const leaseExpired = !j.claimedAt || j.claimedAt < leaseCut;
    const seen = j.threadId ? lastSeen.get(j.threadId) ?? null : null;
    const threadSilent = !!j.threadId && (!seen || seen < beatCut); // the agent (thread) went quiet
    if (!leaseExpired && !threadSilent) continue; // still actively worked — leave it
    if ((j.attempts ?? 0) >= CLAIM_MAX_ATTEMPTS) {
      const reason = j.error ?? `stuck: claimed ${j.attempts}× with no result (auto-failed after ${CLAIM_MAX_ATTEMPTS} attempts)`;
      db.update(jobs).set({ status: "failed", error: reason, claimedAt: null, claimedBy: null }).where(eq(jobs.id, j.id)).run();
      logEvent({ entity: "job", action: "flag", source: "cowork", actor: "CoWork", summary: `job ${j.id} (${j.type}) auto-failed — ${reason}` });
    } else {
      db.update(jobs).set({ status: "queued", claimedAt: null, claimedBy: null }).where(eq(jobs.id, j.id)).run();
      logEvent({ entity: "job", action: "update", source: "cowork", actor: "CoWork", summary: `job ${j.id} (${j.type}) abandoned (${threadSilent ? "agent silent" : "lease expired"}) → requeued` });
    }
    actioned++;
  }
  return actioned;
}

// Queue a job (app→agent handoff, or the agent self-queue via the createJob MCP tool).
// Idempotent on id: re-queuing refreshes the task/params (e.g. discovery re-queues a fit job).
export function createJob(spec: {
  id?: string;
  type: string;
  createdBy?: string | null;
  task?: string;
  params?: Record<string, unknown>;
  // Re-stamp `createdAt` to now when re-queuing an existing job, so it re-sorts as freshly queued
  // and its "queued Xm ago" resets. Set ONLY for genuine user re-submissions (a redo) — the
  // idempotent reconcile/sync paths that re-assert a job every poll leave it off so they don't
  // keep resetting a job's age on each poll.
  bumpQueuedAt?: boolean;
}): string {
  const def = jobDef(spec.type);
  const id = spec.id?.trim() || `${spec.type}-${Date.now().toString(36)}`;
  const params = spec.params ? JSON.stringify(spec.params) : null;
  const task = spec.task ?? def?.buildTask(spec.params) ?? null;
  db.insert(jobs)
    .values({
      id, type: spec.type, createdBy: normCreatedBy(spec.createdBy),
      status: "queued", createdAt: createdAtFromId(id) ?? now(),
      playbook: def?.playbook ?? null, task, params,
    })
    // Re-queuing supersedes any prior result (e.g. a redo, or a fit re-queue) — back to pending,
    // clearing the ingested run AND any stale claim so the ledger row reflects the live queued state.
    // A redo also bumps createdAt so it re-sorts to the top with a fresh queued time.
    // A deliberate re-queue is a FRESH run, so reset the attempt count + dead-letter reason (a poison
    // job auto-failed by reapStuckJobs gets its retry budget back when you re-queue it by hand).
    .onConflictDoUpdate({ target: jobs.id, set: { status: "queued", task, params, ingestedAt: null, result: null, summary: null, claimedAt: null, claimedBy: null, attempts: 0, error: null, ...(spec.bumpQueuedAt ? { createdAt: now() } : {}) } })
    .run();
  return id;
}

// Remove a job from the queue (the floating the agent queue / Agents page). Only `queued` rows are
// removable — ingested rows are history and must survive. Returns whether a row was deleted.
//
// Removing a queued item just cancels that action — it does NOT discard the posting.
//
// A `fit` job is a *projection* of its fit_queue candidate(s): the /api/jobs poll runs
// reconcileFitQueue, which re-creates a fit job for any candidate still in fit_queue — so deleting
// the job row alone makes it reappear on the next refresh. So we also un-queue the candidate: it
// moves fit_queue → `review` (back to the Scan Watchlist triage list, where it sits awaiting your
// decision), which stops the regeneration without discarding it.
//
// A first-time `tailoring` job is similar: its candidate sits in `tailoring` (no resume yet) showing
// "Queued for tailoring…", so deleting the job would strand it. We un-queue it back to `assessed`.
// (A tailoring *redo* job leaves a `tailored` candidate untouched — only its pending note is dropped.)
export function deleteQueuedJob(id: string): boolean {
  // `queued` rows are removable; so is a `wip` row whose lease expired — listJobs surfaces it as
  // queued (with the X control), so the delete has to match the underlying wip row to not no-op.
  const job = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!job || !(job.status === "queued" || isStaleClaim(job.status, job.claimedAt))) return false;
  const def = jobDef(job.type);
  const pid = postingIdOf(job.params);
  // Un-queue the posting this job was a projection of. Without it the self-heal reconcilers re-create
  // the job on the next /api/jobs poll and the delete looks like it silently failed. What "un-queue"
  // means is per-type, so the type owns it (JOB_DEFS.onUnqueue).
  def?.onUnqueue?.({ jobId: id, params: parseParams(job.params), postingId: pid });
  // If this was a redo job (it carries a pending user note), drop that trailing user turn from the
  // posting's conversation so the "Queued for redo" state clears consistently — the live tag reads
  // the queue (gone now), and a fresh load of the posting won't show a dangling pending note.
  if (def?.redoPhase && pid != null) {
    const raw = db.select().from(postings).where(eq(postings.id, pid)).get();
    const log = raw ? parseRedoLog(raw.redoLog) : [];
    const idx = pendingUserIndex(log, def.redoPhase);
    if (raw && idx >= 0) db.update(postings).set({ redoLog: JSON.stringify(log.filter((_, i) => i !== idx)) }).where(eq(postings.id, raw.id)).run();
  }
  db.delete(jobs).where(eq(jobs.id, id)).run();
  return true;
}

// "One type at a time" is PER RUN, not global: a single the agent run drains one type without interleaving,
// but DIFFERENT types may run in parallel across threads (thread A on tailoring while thread B does
// inbox-sync). So enforcement is soft — an explicit `type` is always honored; only a no-type call
// defers to the active type below, so a plain "clear my queue" run won't start a competing type mid-pass.
// listJobs() remaps a stale wip back to "queued", so status "wip" here = a live lease.
export function inFlightType(): string | null {
  const live = listJobs().filter((j) => j.status === "wip");
  if (!live.length) return null;
  return [...live].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0].type;
}

// The DEFAULT type to drain when the caller doesn't pick one (claimNext with no `type`) — so a single
// run stays on one type. Derived purely from the ledger so it survives a run's submit→claim gap:
//   1. The (oldest) in-flight type — a no-type call joins work already started rather than opening a new type.
//   2. Else continue the most recently COMPLETED type while it still has open jobs (keeps one run on the
//      same type across the moment between submit and the next claim).
//   3. Else the OLDEST open job's type (FIFO across batches).
export function activeQueueType(): string | null {
  const inflight = inFlightType();
  if (inflight) return inflight;
  const open = listJobs().filter((j) => j.status === "queued" || j.status === "wip");
  if (open.length === 0) return null;
  const lastDone = db
    .select({ type: jobs.type, ingestedAt: jobs.ingestedAt })
    .from(jobs)
    .where(eq(jobs.status, "ingested"))
    .all()
    .filter((r) => r.ingestedAt)
    .sort((a, b) => (b.ingestedAt ?? "").localeCompare(a.ingestedAt ?? ""))[0];
  if (lastDone && open.some((j) => j.type === lastDone.type)) return lastDone.type;
  return [...open].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0].type;
}

// Low-level atomic take — the shared primitive for both the explicit claimJob and the claimNext loop.
// The UPDATE only matches a row still `queued` (or one whose lease expired, see CLAIM_LEASE_MS), so
// concurrent claims race on the DB and exactly one wins (changes === 1). Returns the claimed job for
// that winner, else null. Reclaiming a stale lease re-stamps claimedAt.
function tryClaim(id: string, by?: string | null, threadId?: string | null): JobView | null {
  const claimedBy = by?.trim() || "CoWork";
  const tid = threadId?.trim() || null;
  const res = db.update(jobs)
    // Stamp the agent chat (thread) that won the claim so the job groups under it in the agent
    // page. Server-derived from the per-chat MCP process's header — the agent passes nothing.
    // Bump `attempts` on EVERY claim (incl. lease-expiry reclaims) — this is the mechanical,
    // agent-independent count reapStuckJobs() uses to dead-letter a job that never produces a result.
    .set({ status: "wip", claimedAt: now(), claimedBy, attempts: sql`${jobs.attempts} + 1`, ...(tid ? { threadId: tid } : {}) })
    .where(and(eq(jobs.id, id), or(
      eq(jobs.status, "queued"),
      // an abandoned claim: wip past its lease, or a wip row that never got a claimedAt stamp
      and(eq(jobs.status, "wip"), or(lt(jobs.claimedAt, claimLeaseCutoff()), isNull(jobs.claimedAt))),
    )))
    .run();
  if (res.changes === 0) return null; // not claimable: a live lease holds it, or it isn't queued
  // Moved-on release: an agent works ONE job at a time, so if this thread was still holding an OLDER
  // `wip` job, it abandoned it the moment it claimed this one — kick that one back to the queue NOW
  // (don't wait out its 60-min lease). This catches the gap the per-thread heartbeat can't: the agent
  // is alive (working this job), but the old one is dead.
  if (tid) {
    const released = db.update(jobs)
      .set({ status: "queued", claimedAt: null, claimedBy: null })
      .where(and(eq(jobs.threadId, tid), eq(jobs.status, "wip"), ne(jobs.id, id)))
      .run();
    if (released.changes) logEvent({ entity: "job", action: "update", source: "cowork", actor: "CoWork", summary: `released ${released.changes} stale wip job(s) — agent moved on to ${id}` });
  }
  const job = listJobs().find((j) => j.id === id) ?? null;
  if (job) logEvent({ entity: "job", action: "update", source: "cowork", actor: "CoWork", summary: `claimed ${job.type} job ${id} (wip)` });
  return job;
}

// Claim a SPECIFIC job by id, so two agents never run the same one. Any type is claimable (parallel
// runs across types are allowed); returns the claimed job, or null when it lost the race / the job is
// already done or missing. `by` tags the holder.
export function claimJob(id: string, by?: string | null, threadId?: string | null): JobView | null {
  return tryClaim(id, by, threadId);
}

// Atomically lease the single oldest claimable job and return it WITH its task/params — the dequeue
// primitive so an agent gets a job and its claim in ONE call. Pass `type` to drain a SPECIFIC queue
// (e.g. "tailoring") — this ALWAYS runs, even alongside another type in flight, so threads can work
// different types in parallel; keep passing the same `type` for the whole run. Omit it to take the
// active type (joins whatever's in flight, so a plain "clear my queue" run stays on one type). One job
// per call, so N agents still share the queue. `by` tags the holder.
export function claimNext(by?: string | null, type?: string | null, threadId?: string | null): JobView | null {
  // Watchdog tick BEFORE dequeuing — so a drain loop can terminate honestly. An abandoned job under
  // budget is requeued (reclaimable); one claimed ≥ CLAIM_MAX_ATTEMPTS with no result is dead-lettered
  // to `failed` (no longer claimable). Without this, an uncompletable job (e.g. a browser-only
  // `leveling` job a headless runner can't finish) re-leases forever and the loop never reaches
  // "no job". Previously this watchdog only ran on the /api/jobs UI poll, not in the claim path.
  reapStuckJobs();
  const target = type ?? activeQueueType();
  if (!target) return null;
  const claimable = listJobs()
    .filter((j) => j.status === "queued" && j.type === target)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest first
  for (const cand of claimable) {
    const won = tryClaim(cand.id, by, threadId); // atomic; loses the race → try the next candidate
    if (won) return won;
  }
  return null;
}

// ── App → the agent wake signal ──
// A pinned the agent chat loops on the `waitForWork` MCP tool (→ /api/jobs/wait), which blocks until
// there's claimable work of its type OR the user clicks "Drain" in the app. That click sets this
// one-shot trigger; the next wait poll consumes it and the agent wakes. This is what lets the app
// drive a waiting chat without you switching to the agent to prompt.
const TRIGGER_KEY = (type: string) => `cowork_trigger:${type}`;
export function setDrainTrigger(type: string): void {
  setConfig(TRIGGER_KEY(type), now());
}
// Consume the trigger (one-shot): true if one was pending, and it's cleared so it fires once.
export function takeDrainTrigger(type: string): boolean {
  if (getConfig(TRIGGER_KEY(type))) {
    deleteConfig(TRIGGER_KEY(type));
    return true;
  }
  return false;
}
// How many jobs of `type` are claimable right now (queued, incl. stale-lease wip via listJobs).
export function queuedCountForType(type: string): number {
  return listJobs().filter((j) => j.status === "queued" && j.type === type).length;
}

// Manually return a stuck/failed job to the queue (the user's recovery when an agent claimed a job
// but never finished, or it was auto-dead-lettered). Clears the claim so another agent can pick it up,
// and resets the attempt budget + dead-letter reason so it gets a fresh run (not instantly re-failed).
// Only `wip`/`failed` rows requeue — an ingested row is history and a queued row is already pending.
export function requeueJob(id: string): boolean {
  const res = db.update(jobs)
    .set({ status: "queued", claimedAt: null, claimedBy: null, ingestedAt: null, attempts: 0, error: null })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ["wip", "failed"])))
    .run();
  if (res.changes === 0) return false;
  logEvent({ entity: "job", action: "update", source: "cowork", actor: "You", summary: `requeued job ${id} (back to queued)` });
  return true;
}

// --- MCP write path: the agent submits a job's result directly (no result file) ------------
// Runs the type's ingest() → reconcile (dedup + needsReview gate) inline, then marks the
// job row ingested with its summary + result. Option B: a self-initiated run may omit jobId;
// we synthesize a ledger row from the type. Returns the reconcile summary so the agent sees it.
export function submitJobResult(input: {
  type: string;
  records: Record<string, unknown>[];
  jobId?: string;
  createdBy?: string | null;
  dryRun?: boolean;
}): { id: string; type: string; summary: string; details?: ChangeDetail[] } {
  const def = jobDef(input.type);
  if (!def) throw new Error(`unknown job type: ${input.type}`);
  const records = Array.isArray(input.records) ? input.records : [];

  // Preview: reconcile is rolled back, nothing recorded.
  if (input.dryRun) {
    const r = def.ingest(records, true);
    return { id: input.jobId?.trim() || "(dry-run)", type: input.type, summary: r.summary, details: r.details };
  }

  const id = input.jobId?.trim() || `${input.type}-${Date.now().toString(36)}`;
  const existing = db.select().from(jobs).where(eq(jobs.id, id)).get();

  // A job that's already `ingested` was finished by an earlier run. Re-submitting the same jobId —
  // e.g. a slow agent whose lease was reclaimed and the work redone by another agent — would clobber
  // the recorded result with stale records (and re-run reconcile's side effects). Skip the duplicate
  // and hand back what's on file. A genuine re-run goes through createJob first, which flips the row
  // back to `queued`, so it won't hit this guard. (No jobId → a fresh synthesized id, never matches.)
  if (existing?.status === "ingested") {
    return { id, type: input.type, summary: existing.summary ?? `${input.type} already ingested` };
  }

  // Claim gate: a result may only land for a job you actually hold. When the caller names a real
  // queued-lifecycle row, it must currently be `wip` under a live lease (taken via claimNext /
  // claimJob) — otherwise the submit is either for a job nobody claimed (claim-first was skipped) or
  // one whose lease expired and may have been reclaimed, so reject it rather than clobber. A
  // self-initiated run is exempt: it passes no jobId (or a synthesized id with no row), so `existing`
  // is undefined and it just synthesizes a ledger entry below.
  if (input.jobId && existing && !(existing.status === "wip" && !isStaleClaim(existing.status, existing.claimedAt)))
    throw new Error(`job ${id} isn't held by a live claim — claim it with claimNext (or claimJob) before submitting its result`);

  const result = def.ingest(records);
  const ingestedAt = now();
  db.insert(jobs)
    .values({
      id, type: input.type, createdBy: normCreatedBy(input.createdBy ?? existing?.createdBy),
      status: "ingested", createdAt: existing?.createdAt ?? createdAtFromId(id) ?? ingestedAt,
      ingestedAt, summary: result.summary, result: JSON.stringify(records),
      playbook: existing?.playbook ?? def.playbook, task: existing?.task ?? null, params: existing?.params ?? null,
    })
    .onConflictDoUpdate({
      target: jobs.id,
      set: { status: "ingested", ingestedAt, summary: result.summary, result: JSON.stringify(records) },
    })
    .run();
  // Per-type bookkeeping that writes outside this ingest's own domain (the inbox watermark). Every
  // guard above has already run, so this fires exactly once per job, only for a real, claimed run.
  def.afterIngest?.({ jobId: id, params: parseParams(existing?.params), ingestedAt, records, result });
  return { id, type: input.type, summary: result.summary, details: result.details };
}
