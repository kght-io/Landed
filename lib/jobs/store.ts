import { and, eq, ne, inArray, or, lt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, postings, companies, prepCompany, threads } from "@/lib/db/schema";
import type { PostingRow } from "@/lib/db/schema";
import { getConfig, setConfig, deleteConfig } from "@/lib/db/config-store";
import { logEvent, getPosting } from "@/lib/db/queries";
import { norm, canonical } from "@/lib/agents/canonical";
import { slugFor } from "@/lib/config";
import { exportPrepContextFor, exportQuestionsFor } from "@/lib/prep/export-context";
import { TRACKER_STAGES } from "@/lib/pipeline";
import { jobDef } from "./registry";
import { parseRedoLog, nextVersion, renderThread, hasPendingRedo, pendingRedoNote, pendingUserIndex } from "./redolog";
import type { FitInput, FitQueueItem } from "./types";
import type { Posting, RedoPhase, RedoTurn } from "@/lib/types";
import type { ChangeDetail } from "@/lib/agents/types";

export const INBOX_SYNCED_KEY = "inbox_last_synced";
export const inboxLastSynced = () => getConfig(INBOX_SYNCED_KEY);

// The read-context the agent works against — for the "What it sees" panel.
export function agentContext() {
  const cos = db.select().from(companies).all();
  return {
    // discovery auto-scans the watchlist only (independent of tier)
    targets: cos.filter((c) => c.watchlist).length,
    tracked: db.select().from(postings).where(inArray(postings.state, [...TRACKER_STAGES])).all().length,
    syncedThrough: inboxLastSynced() ?? null, // full ISO timestamp
  };
}

const now = () => new Date().toISOString();

// A claim is a *lease*, not a permanent lock. An agent flips a job to `wip` before working it; if that
// agent crashes, abandons the run, or stalls, the claim would otherwise pin the job in `wip` forever.
// After the lease expires the job is treated as abandoned: claimable again (claimJob wins against it)
// and surfaced as pending in listings, so the next run reclaims it with no manual step. A `wip` row
// with a null claimedAt (legacy/torn write) counts as stale too, so it can never get stuck.
const CLAIM_LEASE_MS = 60 * 60 * 1000;
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
const isStaleClaim = (status: string, claimedAt?: string | null): boolean =>
  status === "wip" && (!claimedAt || Date.parse(claimedAt) < Date.now() - CLAIM_LEASE_MS);
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

const parseParams = (raw: string | null | undefined): Record<string, unknown> => {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
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

// Queue the daily auto inbox-sync, idempotently. `id` is the caller's day-keyed id
// (`dailySyncJobId` → `inbox-sync-daily-YYYY-MM-DD`), which makes "once per day" a DB fact rather
// than a client-state hope: the UI timer can fire repeatedly — a double-invoked effect, a second
// tab, a tick inside the 25s queue-poll gap — and only the first one queues.
//
// Two guards, both needed:
//  - the day's row already exists in ANY status → stand down. Not a `createJob` upsert: that would
//    bounce an already-INGESTED row back to `queued` and re-run the day's sync.
//  - some other inbox-sync is outstanding (a manual click, "Update interview status") → stand down
//    rather than stack a second sync of the same mail.
// Returns whether it actually queued.
export function enqueueDailyInboxSync(id: string): boolean {
  if (db.select().from(jobs).where(eq(jobs.id, id)).get()) return false; // today's slot already handled
  const outstanding = !!db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, "inbox-sync"), inArray(jobs.status, ["queued", "wip"])))
    .get();
  if (outstanding) return false;
  createJob({ id, type: "inbox-sync", createdBy: "You" });
  return true;
}

// Queue a `watchlist-scan` job per watchlisted company not scraped in the last `staleDays` (or
// never), skipping any that already have an outstanding (queued/wip) scan job. Deterministic id per
// company → idempotent: re-clicking "Scrape watchlist" won't duplicate or disturb in-flight scans.
// This is the ONLY way watchlist scans enter the queue (the agent no longer self-initiates them).
export function queueStaleWatchlistScans(staleDays = 3): { queued: number; skipped: number; total: number } {
  const cutoff = Date.now() - staleDays * 86_400_000;
  const stale = db.select().from(companies).where(eq(companies.watchlist, true)).all()
    .filter((co) => !co.lastScrapedAt || new Date(co.lastScrapedAt).getTime() < cutoff);
  const statusById = new Map(listJobs().map((j) => [j.id, j.status]));
  let queued = 0, skipped = 0;
  for (const co of stale) {
    const jid = `watchlist-scan-${co.id}`;
    const st = statusById.get(jid);
    if (st === "queued" || st === "wip") { skipped++; continue; } // already in flight — leave it
    createJob({ id: jid, type: "watchlist-scan", createdBy: "You", params: { company: co.name } });
    queued++;
  }
  return { queued, skipped, total: stale.length };
}

// Queue a `watchlist-scan` job for ONE watchlisted company on demand (the per-row "Scan now"
// button) — same deterministic id (`watchlist-scan-<id>`) and idempotency as the bulk path, so it
// dedups against an in-flight scan and won't duplicate a company already queued by "Scrape watchlist".
// Unlike the bulk sweep, staleness is ignored — an explicit per-company scan always queues.
export function queueWatchlistScan(name: string): { status: "queued" | "in-flight" | "not-found"; company?: string } {
  const key = canonical(name)?.key;
  const co = key ? db.select().from(companies).where(eq(companies.watchlist, true)).all().find((c) => canonical(c.name)?.key === key) : undefined;
  if (!co) return { status: "not-found" };
  const jid = `watchlist-scan-${co.id}`;
  const st = new Map(listJobs().map((j) => [j.id, j.status])).get(jid);
  if (st === "queued" || st === "wip") return { status: "in-flight", company: co.name };
  createJob({ id: jid, type: "watchlist-scan", createdBy: "You", params: { company: co.name } });
  return { status: "queued", company: co.name };
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
  if (job.type === "fit") {
    for (const fp of (parseParams(job.params).postings as (FitPosting & { id?: number })[] | undefined) ?? []) {
      if (fp.id == null) continue;
      const cand = db.select().from(postings).where(eq(postings.id, Number(fp.id))).get();
      if (cand?.state === "fit_queue") {
        db.update(postings).set({ state: "review" }).where(eq(postings.id, cand.id)).run();
        const co = db.select().from(companies).where(eq(companies.id, cand.companyId)).get();
        logEvent({ entity: "company", entityId: cand.companyId, action: "update", source: "discovery", summary: `${co?.name ?? "?"} — ${cand.title} · un-queued from fit (removed from the agent queue)` });
      }
    }
  }
  if (job.type === "tailoring") {
    // A first-time tailoring job leaves its candidate parked in `tailoring` with no resume yet — the
    // funnel shows it as "Queued for tailoring…". Deleting the job would strand it there forever, so
    // un-queue it back to `assessed` (its pre-tailor stage in Fit Assessment), mirroring fit→review.
    // A *redo* job's candidate is already `tailored` (resume kept) — skip it; only the trailing
    // pending note is dropped below, leaving the resume and stage intact.
    for (const tp of (parseParams(job.params).postings as { id?: number }[] | undefined) ?? []) {
      if (tp.id == null) continue;
      const cand = db.select().from(postings).where(eq(postings.id, Number(tp.id))).get();
      if (cand?.state === "tailoring" && !cand.resumeDir) {
        db.update(postings).set({ state: "assessed" }).where(eq(postings.id, cand.id)).run();
        const co = db.select().from(companies).where(eq(companies.id, cand.companyId)).get();
        logEvent({ entity: "company", entityId: cand.companyId, action: "update", source: "tailoring", summary: `${co?.name ?? "?"} — ${cand.title} · un-queued from tailoring (removed from the agent queue)` });
      }
    }
  }
  // If this was a redo job (it carries a pending user note), drop that trailing user turn from the
  // posting's conversation so the "Queued for redo" state clears consistently — the live tag reads
  // the queue (gone now), and a fresh load of the posting won't show a dangling pending note.
  const phase: RedoPhase | null = job.type === "tailoring" ? "tailor" : job.type === "fit" ? "fit" : null;
  if (phase) {
    const pid = Number((parseParams(job.params).postings as { id?: number }[] | undefined)?.[0]?.id);
    if (Number.isFinite(pid)) {
      const raw = db.select().from(postings).where(eq(postings.id, pid)).get();
      const log = raw ? parseRedoLog(raw.redoLog) : [];
      const idx = pendingUserIndex(log, phase);
      if (raw && idx >= 0) db.update(postings).set({ redoLog: JSON.stringify(log.filter((_, i) => i !== idx)) }).where(eq(postings.id, pid)).run();
    }
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

// Auto-queue a one-shot prep-research job the first time a company reaches the interview
// stage (fires from both the manual board move and inbox-sync). Idempotent on a per-company
// id so re-entering 'interview', or a second posting at the same company, won't double-queue;
// skipped entirely once a profile exists (a manual "re-research" uses its own path). Best-effort:
// never throws into the caller's mutation.
export function maybeQueuePrepResearch(companyId: number, beforeStatus: string | null | undefined, afterStatus: string): void {
  try {
    if (afterStatus !== "interview" || beforeStatus === "interview") return;
    const co = db.select().from(companies).where(eq(companies.id, companyId)).get();
    if (!co) return;
    const id = `prep-research-${companyId}`;
    if (db.select().from(jobs).where(eq(jobs.id, id)).get()) return; // already queued/ran
    const slug = canonical(co.name)?.key;
    if (slug && db.select().from(prepCompany).where(eq(prepCompany.slug, slug)).get()) return; // already researched
    createJob({ id, type: "prep-research", createdBy: "CoWork", params: { company: co.name } });
  } catch {
    // queueing prep research must never break the status update that triggered it
  }
}

// The first-hand intel snapshot a posting carries into prep-research — comp structure, team/product
// notes, and the recruiter-described loop. The job treats this as authoritative ground truth (see
// instructions/prep-research.md), grounding the prep page in the real loop instead of guesses.
function prepIntelFor(p: Posting): { comp?: string; teamNotes?: string; rounds?: { kind?: string; date?: string; notes?: string }[] } | undefined {
  const rounds = (p.interviews ?? []).map((r) => ({ kind: r.kind, date: r.date, notes: r.notes })).filter((r) => r.kind || r.date || r.notes);
  const intel = {
    ...(p.comp?.trim() ? { comp: p.comp.trim() } : {}),
    ...(p.teamNotes?.trim() ? { teamNotes: p.teamNotes.trim() } : {}),
    ...(rounds.length ? { rounds } : {}),
  };
  return Object.keys(intel).length ? intel : undefined;
}

// Manually (re)queue a prep-research job for one posting's company, carrying its current intel
// snapshot. Idempotent on the deterministic `prep-research-<companyId>` id — createJob supersedes a
// prior run, so the drawer's "Generate prep" button re-runs cleanly. Returns the job id (or null if
// the posting is gone).
export function queuePrepResearch(appId: number): { jobId: string; slug: string | null } | null {
  const row = db.select().from(postings).where(eq(postings.id, appId)).get();
  const p = getPosting(appId);
  if (!row || !p) return null;
  const companyId = row.companyId;
  const intel = prepIntelFor(p);
  const jobId = createJob({
    id: `prep-research-${companyId}`,
    type: "prep-research",
    createdBy: "You",
    params: { company: p.company, role: p.role, ...(intel ? { intel } : {}) },
  });
  return { jobId, slug: canonical(p.company)?.key ?? null };
}

// (Re)queue an interview-brief job for one posting — The agent reads that company's interview-prep
// asset folder (context.md + dropped transcripts + fetched emails) and returns a versioned brief.
// Deterministic id `interview-brief-<postingId>` so the drawer's "Generate" button re-runs cleanly
// (createJob supersedes the prior run). Params carry the posting id (the ID-only ingest key), the
// company/role, and the folder slug so the task can point at interview-prep/<slug>/. Returns the
// job id + slug (or null if the posting is gone).
export function enqueueInterviewBrief(appId: number): { jobId: string; slug: string | null } | null {
  const p = getPosting(appId);
  if (!p) return null;
  const slug = canonical(p.company)?.key ?? null;
  const jobId = createJob({
    id: `interview-brief-${appId}`,
    type: "interview-brief",
    createdBy: "You",
    params: { id: appId, company: p.company, role: p.role, ...(slug ? { slug } : {}) },
  });
  return { jobId, slug };
}

// (Re)queue a "pull interview emails" job for a posting's COMPANY — The agent sweeps that company's
// interviewing emails (last ~3 months) into interview-prep/<slug>/ (emails.md + attachments/). Keyed
// by companyId (the folder is per-company) so re-runs supersede. Asset-only; never touches tracker
// status. `since` is a Gmail-style YYYY/MM/DD date 3 months back so the query is deterministic (the
// buildTask can't compute dates). Returns the job id + slug (or null if the posting is gone).
export function enqueueInterviewEmails(appId: number): { jobId: string; slug: string | null } | null {
  const row = db.select().from(postings).where(eq(postings.id, appId)).get();
  const p = getPosting(appId);
  if (!row || !p) return null;
  const slug = canonical(p.company)?.key ?? null;
  const since = new Date(Date.now() - 92 * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "/");
  const jobId = createJob({
    id: `interview-emails-${row.companyId}`,
    type: "interview-emails",
    createdBy: "You",
    params: { company: p.company, ...(slug ? { slug } : {}), since },
  });
  return { jobId, slug };
}

// Queue the GLOBAL peer-comp job — The agent compares comp across every actively-interviewing role and
// submits ONE { markdown } artifact (stored latest-only). Fixed id "peer-comp" so a re-run always
// supersedes the outstanding one (createJob upserts). No appId — the roster is derived at build time.
export function enqueuePeerComp(): { jobId: string } {
  const jobId = createJob({ id: "peer-comp", type: "peer-comp", createdBy: "You" });
  return { jobId };
}

// One-click "Update interview status": bring every actively-interviewing company up to date in a
// single fan-out. Queues a global inbox-sync (moves tracker status/rounds/dates — unless one is
// already outstanding), then for each company with an interview/offer posting (deduped to one
// representative posting): refreshes its on-disk context.md/questions.md NOW, (re)queues the
// interview-emails job EVERY time, and queues prep-research ONLY if it's never been done (same guard
// as maybeQueuePrepResearch). Pure orchestration over the existing enqueue helpers. Returns counts.
export function updateInterviewStatus(): {
  inboxSync: boolean;
  companies: number;
  foldersRefreshed: number;
  emailsQueued: number;
  researchQueued: number;
} {
  // 0. Global inbox-sync — once. Skip if one is already queued/wip so clicks don't stack duplicates.
  const inboxOutstanding = !!db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, "inbox-sync"), inArray(jobs.status, ["queued", "wip"])))
    .get();
  let inboxSync = false;
  if (!inboxOutstanding) {
    createJob({ type: "inbox-sync", createdBy: "You" });
    inboxSync = true;
  }

  // Active interview/offer postings, deduped to one representative posting per company.
  const byCompany = new Map<number, PostingRow>();
  for (const row of db.select().from(postings).where(inArray(postings.state, ["interview", "offer"])).all()) {
    if (!byCompany.has(row.companyId)) byCompany.set(row.companyId, row);
  }

  let foldersRefreshed = 0;
  let emailsQueued = 0;
  let researchQueued = 0;
  for (const [companyId, row] of byCompany) {
    const co = db.select().from(companies).where(eq(companies.id, companyId)).get();
    const slug = co ? canonical(co.name)?.key ?? null : null;
    // 1. Refresh the asset folder now (best-effort — must never break the rest of the fan-out).
    if (slug) {
      try {
        exportPrepContextFor(slug);
        exportQuestionsFor(slug);
        foldersRefreshed++;
      } catch {
        // a bad dump for one company shouldn't abort the others
      }
    }
    // 2. Pull interview emails — every time.
    if (enqueueInterviewEmails(row.id)) emailsQueued++;
    // 3. Question research — only if never done (no profile AND no prior prep-research job).
    const researched = !!(slug && db.select().from(prepCompany).where(eq(prepCompany.slug, slug)).get());
    const jobExists = !!db.select().from(jobs).where(eq(jobs.id, `prep-research-${companyId}`)).get();
    if (!researched && !jobExists && queuePrepResearch(row.id)) researchQueued++;
  }

  return { inboxSync, companies: byCompany.size, foldersRefreshed, emailsQueued, researchQueued };
}

// --- fit queue (postings sent for fit assessment) ----------------------------------------
type FitPosting = { company?: string; role?: string; jd?: string; url?: string };

const trimmed = (v?: string) => v?.trim() || undefined;
const normalizeFitInput = (input: FitInput) => ({
  company: input.company.trim(),
  role: trimmed(input.role),
  url: trimmed(input.url),
  jd: input.jd,
});

// Pending fit jobs = queued OR claimed-but-unfinished (wip). A wip job is still outstanding work
// (no result yet), so it counts as "covering" its candidate — both for the editable queue list and
// for reconcileFitQueue's dedup, so a claimed fit job is never regenerated as a duplicate.
const PENDING_JOB_STATUSES = ["queued", "wip"] as const;

export function listFitQueue(): FitQueueItem[] {
  const rows = db.select().from(jobs).where(and(eq(jobs.type, "fit"), inArray(jobs.status, [...PENDING_JOB_STATUSES]))).all();
  const out: FitQueueItem[] = [];
  for (const r of rows) {
    const postings = (parseParams(r.params).postings as FitPosting[]) ?? [];
    const editable = postings.length === 1;
    for (const p of postings)
      out.push({
        jobId: r.id, company: p.company ?? "—", role: p.role || undefined, url: p.url || undefined,
        createdBy: normCreatedBy(r.createdBy), createdAt: r.createdAt, hasJd: !!p.jd, editable,
      });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// You add a posting to the fit queue from the app. Mirrors the agent's discovery:
// (1) ensure a CANDIDATE exists in fit_queue (so the eventual fit result matches it, and it
// shows in the Discovery funnel — discovery is postings, not applications), and
// (2) queue a fit job with the pasted JD for the agent to score.
function ensureFitQueueCandidate(company: string, role?: string, url?: string, jd?: string): number {
  const key = canonical(company)?.key;
  let co = key ? db.select().from(companies).all().find((c) => canonical(c.name)?.key === key) : undefined;
  if (!co) { const ts = new Date().toISOString(); co = db.insert(companies).values({ name: company, tier: "tier3", createdAt: ts, updatedAt: ts }).returning().get(); }
  const list = db.select().from(postings).where(eq(postings.companyId, co.id)).all();
  const existing = (url ? list.find((c) => c.url === url) : undefined)
    ?? (role ? list.find((c) => norm(c.title) === norm(role)) : undefined);
  // Persist the pasted JD onto the posting immediately so it's not blank in the UI until the agent
  // scores it. Only overwrite an existing row's JD when a new one is supplied.
  if (existing) {
    db.update(postings).set({ state: "fit_queue", ...(jd ? { jd } : {}) }).where(eq(postings.id, existing.id)).run();
    return existing.id;
  }
  return db.insert(postings)
    .values({ companyId: co.id, title: role ?? "(untitled)", url: url ?? null, jd: jd ?? null, verdict: "kept", reason: null, state: "fit_queue", scannedAt: now() })
    .returning({ id: postings.id })
    .get().id;
}

export function enqueueFit(input: FitInput): FitQueueItem {
  const { company, role, url, jd } = normalizeFitInput(input);
  const candId = ensureFitQueueCandidate(company, role, url, jd);
  const id = `fit-app-${Date.now().toString(36)}`;
  createJob({
    id, type: "fit", createdBy: "You",
    task: "Assess fit for the posting below (JD provided).",
    params: { postings: [{ id: candId, company, role, jd, url }] },
  });
  const createdAt = db.select().from(jobs).where(eq(jobs.id, id)).get()?.createdAt ?? now();
  return { jobId: id, company, role, url, createdBy: "You", createdAt, hasJd: !!input.jd, editable: true };
}

// Self-heal the fit queue. Every candidate parked in `fit_queue` must have a QUEUED fit job for
// The agent to pick up — but the two can drift: a candidate enters fit_queue without a job (the
// legacy watchlist-scan ingest), or a fit result fails to match its candidate so the job ingests
// while the candidate never advances. Either way the Discovery funnel shows work that the agent
// can't see. Enqueue a fit job for any fit_queue candidate not already covered by a queued one.
// Idempotent: a candidate covered by a queued job is skipped, so repeat calls (e.g. every the agent
// poll) are cheap and won't duplicate.
const fitKeys = (company?: string | null, role?: string | null, url?: string | null): string[] => {
  const ks = [`cr:${norm(company ?? "")}|${norm(role ?? "")}`];
  if (url) ks.push(`u:${url}`);
  return ks;
};
export function reconcileFitQueue(): number {
  // Common case is an empty fit queue — check that first so a routine /api/jobs poll skips the
  // queued-jobs and companies scans entirely.
  const pending = db.select().from(postings).where(eq(postings.state, "fit_queue")).all();
  if (!pending.length) return 0;

  const covered = new Set<string>();
  for (const r of db.select().from(jobs).where(and(eq(jobs.type, "fit"), inArray(jobs.status, [...PENDING_JOB_STATUSES]))).all())
    for (const p of (parseParams(r.params).postings as FitPosting[]) ?? [])
      for (const k of fitKeys(p.company, p.role, p.url)) covered.add(k);

  const coById = new Map(db.select().from(companies).all().map((c) => [c.id, c] as const));
  let created = 0;
  for (const cand of pending) {
    const co = coById.get(cand.companyId);
    if (!co) continue;
    const keys = fitKeys(co.name, cand.title, cand.url);
    if (keys.some((k) => covered.has(k))) continue;
    createJob({
      type: "fit",
      createdBy: "CoWork",
      task: "Assess fit for the posting below. Use the JD in params if present, else fetch it from the URL; then score per fit.md.",
      params: { postings: [{ id: cand.id, company: co.name, role: cand.title, url: cand.url ?? undefined, jd: cand.jd ?? "" }] },
    });
    keys.forEach((k) => covered.add(k));
    created++;
  }
  return created;
}

// The id of an OUTSTANDING (queued or wip) fit job that already covers this posting, or null. Fit
// jobs are created by several paths with different id schemes (a JD-add via enqueueFit → fit-app-*,
// a funnel queue-fit → fit-cand-*), so dedup by the posting id carried in the job params, not by id.
export function outstandingFitJobId(postingId: number): string | null {
  for (const r of db.select().from(jobs).where(and(eq(jobs.type, "fit"), inArray(jobs.status, [...PENDING_JOB_STATUSES]))).all()) {
    const ps = (parseParams(r.params).postings as { id?: unknown }[] | undefined) ?? [];
    if (ps.some((p) => Number(p?.id) === postingId)) return r.id;
  }
  return null;
}

// The JD isn't stored on the posting — it lives in the fit job that assessed it. Pull it
// forward so the tailoring job carries the JD instead of making the agent re-fetch from the URL.
// Match by canonical company (+ role when known) across all fit jobs (queued or ingested).
function findFitJd(company: string, role?: string): string | undefined {
  const wantCo = norm(company);
  const wantRole = norm(role ?? "");
  for (const r of db.select().from(jobs).where(eq(jobs.type, "fit")).all()) {
    for (const fp of (parseParams(r.params).postings as FitPosting[] | undefined) ?? []) {
      if (fp.jd && norm(fp.company ?? "") === wantCo && (!wantRole || norm(fp.role ?? "") === wantRole)) return fp.jd;
    }
  }
  return undefined;
}

// Keep the tailoring queue in sync with a posting's stage. When a posting enters "Queued"
// (status `tailoring`, no resume slug) we queue a tailoring job; when it leaves we drop the
// still-pending one (an already-ingested row stays as history). Deterministic per posting id.
export function removeTailoringJob(appId: number | string): void {
  db.delete(jobs).where(eq(jobs.id, `tailoring-app-${appId}`)).run();
}

export function syncTailoringJob(p: Posting, opts?: { keepPending?: boolean }): void {
  const id = `tailoring-app-${p.id}`;
  const existing = db.select().from(jobs).where(eq(jobs.id, id)).get();
  // Fresh tailor: entered the stage and no resume yet (v1). Redos go through requeueRedo, not here.
  const queued = p.status === "tailoring" && !p.resumeDir;
  if (!queued) {
    // Drop a stale, still-pending tailoring job when the posting leaves the tailor stage — but NOT
    // a redo job: a `tailored` posting with a queued redo keeps it (the redo runs against the
    // resume it already has). Only a true stage exit (e.g. → applied) clears it. `keepPending` (the
    // user chose "keep the job" in the move confirm) also spares it — the queued action outlives the
    // status move.
    const keepRedo = (p.status as string) === "tailored" && hasPendingRedo(p.redoLog ?? [], "tailor");
    if (existing && existing.status === "queued" && !keepRedo && !opts?.keepPending) db.delete(jobs).where(eq(jobs.id, id)).run();
    return;
  }
  enqueueTailoring(p);
}

// The stable base slug for a posting's tailored-resume folder; versions nest under it
// (resume/<base>/v1, /v2, …). Deterministic from the posting id so it never collides.
const baseSlugForPosting = (p: Posting): string =>
  slugFor({ company: p.company, title: p.role, jobId: String(p.id) });

// Build the tailoring task for one version: name the EXACT target folder and replay the redo
// conversation so the agent honors the latest redo request.
function tailoringTask(p: Posting, version: number, targetSlug: string): string {
  const thread = renderThread(p.redoLog ?? [], "tailor");
  const lines = [
    `Tailor my base resume to the posting below per tailoring.md. This is version v${version}.`,
    `Save it to resume/${targetSlug}/ (use that EXACT folder) and echo slug:"${targetSlug}" back in the result.`,
  ];
  if (thread) lines.push(`Prior tailor conversation (your earlier notes + my redo requests) — honor the latest redo request:\n${thread}`);
  return lines.join("\n");
}

// Queue (or re-assert) the tailoring job for a posting, targeting the NEXT version folder and
// carrying the redo conversation. Used for the first tailor (v1, via syncTailoringJob) and every
// redo (vN, via requeueRedo). Idempotent on the stable per-posting job id.
export function enqueueTailoring(p: Posting, opts?: { bumpQueuedAt?: boolean }): void {
  const version = nextVersion(p.redoLog ?? [], "tailor");
  const targetSlug = `${baseSlugForPosting(p)}/v${version}`;
  // Carry the JD from the fit job if we have it; else fall back to the JD stored on the posting row
  // (a funnel "Tailor" can skip fit). Empty → the agent fetches from the URL per tailoring.md.
  const jd = findFitJd(p.company, p.role)
    ?? db.select({ jd: postings.jd }).from(postings).where(eq(postings.id, Number(p.id))).get()?.jd
    ?? undefined;
  const redoNote = pendingRedoNote(p.redoLog ?? [], "tailor"); // empty for the first tailor (v1)
  createJob({
    id: `tailoring-app-${p.id}`,
    type: "tailoring",
    createdBy: "You",
    task: tailoringTask(p, version, targetSlug),
    // redoNote rides on the job so the live UI (which reads the queue, not the posting) can show the
    // "Queued for redo" tag + pre-fill the editable note — present only when this is a redo.
    params: { postings: [{ id: Number(p.id), company: p.company, role: p.role, url: p.url, slug: targetSlug, version, ...(jd ? { jd } : {}) }], ...(redoNote ? { redoNote } : {}) },
    bumpQueuedAt: opts?.bumpQueuedAt,
  });
}

// Self-heal the tailoring queue — the tailor-stage analogue of reconcileFitQueue. A candidate can be
// parked in `tailoring` (no resume yet → the funnel shows "Queued for tailoring…") or `tailored` with
// a pending redo, yet have NO live tailoring job for the agent to pick up: the job row was deleted, a
// result ingested without advancing the candidate, or an early funnel-tailor created a generated-id
// job that the stable `tailoring-app-<id>` path never tracked. Re-enqueue a tailoring job for any such
// candidate not already covered by a queued/wip one. Idempotent — enqueueTailoring keys on the stable
// per-posting id, so repeat calls (every /api/jobs poll) are cheap and won't duplicate.
export function reconcileTailoringQueue(): number {
  const cands = db.select().from(postings).where(inArray(postings.state, ["tailoring", "tailored"])).all();
  if (!cands.length) return 0;
  let created = 0;
  for (const c of cands) {
    const needs =
      (c.state === "tailoring" && !c.resumeDir) || // first-time tailor pending (v1)
      (c.state === "tailored" && hasPendingRedo(parseRedoLog(c.redoLog), "tailor")); // redo pending
    if (!needs) continue;
    const job = db.select().from(jobs).where(eq(jobs.id, `tailoring-app-${c.id}`)).get();
    if (job && (job.status === "queued" || job.status === "wip")) continue; // already covered
    const p = getPosting(c.id);
    if (p) { enqueueTailoring(p); created++; }
  }
  return created;
}

// Build the fit re-assessment task for a redo: replay the fit conversation so the agent addresses
// the latest redo request rather than re-scoring from scratch.
function fitRedoTask(p: Posting): string {
  const thread = renderThread(p.redoLog ?? [], "fit");
  const lines = ["Re-assess fit for the posting below per fit.md. Use the JD in params if present, else fetch it from the URL."];
  if (thread) lines.push(`Prior fit conversation (your earlier assessments + my redo requests) — address the latest redo request:\n${thread}`);
  return lines.join("\n");
}

// Queue a fit re-assessment for an already-assessed posting (the redo path). Distinct job id from
// the discovery fit job so it doesn't collide with reconcileFitQueue's self-heal.
export function enqueueFitRedo(p: Posting): void {
  const jd = findFitJd(p.company, p.role);
  const redoNote = pendingRedoNote(p.redoLog ?? [], "fit");
  createJob({
    id: `fit-redo-${p.id}`,
    type: "fit",
    createdBy: "You",
    task: fitRedoTask(p),
    // redoNote rides on the job for the live "Queued for redo" tag + editable pre-fill (see enqueueTailoring).
    params: { postings: [{ id: Number(p.id), company: p.company, role: p.role, url: p.url, ...(jd ? { jd } : {}) }], ...(redoNote ? { redoNote } : {}) },
    bumpQueuedAt: true, // a fit redo is always a fresh user re-submission → refresh its queued time
  });
}

// Append a user redo turn to a posting's conversation and re-queue that phase's job at the next
// version. The note becomes a turn the agent replays on its next run. For tailor, the posting
// drops back to `tailoring` (resume_dir stays — it points at the latest version until the redo
// lands). Returns the version the queued run will produce, or null if the posting is gone.
export function requeueRedo(appId: number, phase: RedoPhase, note: string): { version: number } | null {
  const raw = db.select().from(postings).where(eq(postings.id, appId)).get();
  if (!raw) return null;
  const log = parseRedoLog(raw.redoLog);
  const turn: RedoTurn = { phase, role: "user", at: now(), text: note };
  // Edit the pending note in place if a redo for this phase is already queued (the user reopened
  // the popup and tweaked it) — otherwise append. Never stack two consecutive user turns.
  const pendingIdx = pendingUserIndex(log, phase);
  const nextLog = pendingIdx >= 0 ? log.map((t, i) => (i === pendingIdx ? turn : t)) : [...log, turn];
  // Keep the posting in its current stage (tailored / assessed) — a pending redo is a *tag*, not a
  // stage regression. The live artifact stays usable until the redo lands.
  db.update(postings).set({ redoLog: JSON.stringify(nextLog) }).where(eq(postings.id, appId)).run();

  const p = getPosting(appId);
  if (!p) return null;
  // A redo is a fresh user re-submission → bump the job's queued time so it re-sorts to the top.
  if (phase === "tailor") enqueueTailoring(p, { bumpQueuedAt: true });
  else enqueueFitRedo(p);

  const version = nextVersion(p.redoLog ?? [], phase);
  const co = db.select().from(companies).where(eq(companies.id, raw.companyId)).get();
  logEvent({ entity: "company", entityId: raw.companyId, action: "update", source: phase === "fit" ? "fit" : "tailoring", summary: `${co?.name ?? "?"} — ${raw.title} · redo ${phase} → v${version} queued` });
  return { version };
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
  // inbox: advance the sync watermark now that the result is in the DB
  if (input.type === "inbox-sync") setConfig(INBOX_SYNCED_KEY, ingestedAt);
  // watchlist-scan: stamp last_scraped_at on every company this run surfaced a posting for, PLUS the
  // company named on the job itself — so closing a per-company scan job marks it scraped even when it
  // surfaced nothing / is a manual company (which scanCompany doesn't stamp). Prevents re-queueing.
  if (input.type === "watchlist-scan") {
    const jobCo = input.jobId
      ? (parseParams(db.select().from(jobs).where(eq(jobs.id, input.jobId)).get()?.params).company as string | undefined)
      : undefined;
    stampScraped(jobCo ? [...records, { company: jobCo }] : records, ingestedAt);
  }
  return { id, type: input.type, summary: result.summary, details: result.details };
}

// Mark the companies named in a discovery result as freshly scraped (powers the Targets
// table's "last scraped"). Matched by canonical name against existing companies.
function stampScraped(records: Record<string, unknown>[], at: string): void {
  const keys = new Set<string>();
  for (const r of records) {
    const c = canonical(String(r.company ?? ""));
    if (c) keys.add(c.key);
  }
  if (!keys.size) return;
  for (const co of db.select().from(companies).all()) {
    if (keys.has(canonical(co.name)?.key ?? "")) {
      db.update(companies).set({ lastScrapedAt: at }).where(eq(companies.id, co.id)).run();
    }
  }
}
