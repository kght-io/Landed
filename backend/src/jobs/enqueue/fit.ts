import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { jobs, postings, companies } from "../../db/schema";
import { norm, canonical } from "@landed/shared/agents/canonical";
import { renderThread, pendingRedoNote } from "@landed/shared/jobs/redolog";
import { createJob, parseParams, normCreatedBy, now } from "../queue";
import type { FitInput, FitQueueItem } from "@landed/shared/jobs/types";
import type { Posting } from "@landed/shared/types";

// fit: scoring a posting against the profile, plus the fit-queue self-heal.
//
// Part of the jobs/ split: this file owns WHEN a job of this kind is queued (and what it carries).
// The type-agnostic lifecycle — claim, lease, reap, ingest — lives in ../queue.ts.

// --- fit queue (postings sent for fit assessment) ----------------------------------------
type FitPosting = { company?: string; role?: string; jd?: string; url?: string };

// The STABLE per-posting fit job id — every path that queues a posting for fit (the funnel's
// queue-fit, the AddFitModal JD-add, the self-heal reconciler, a redo) uses it, so `createJob`'s
// upsert collapses them onto one row instead of stacking duplicates the agent would score twice.
// Mirrors `tailoring-app-<id>`. This is what makes "does this posting have a fit job?" a keyed
// lookup rather than a scan of every fit job's JSON params.
const fitJobId = (postingId: number | string): string => `fit-${postingId}`;

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
  const id = fitJobId(candId);
  createJob({
    id, type: "fit", createdBy: "You",
    task: "Assess fit for the posting below (JD provided).",
    params: { postings: [{ id: candId, company, role, jd, url }] },
  });
  const createdAt = db.select().from(jobs).where(eq(jobs.id, id)).get()?.createdAt ?? now();
  return { jobId: id, company, role, url, createdBy: "You", createdAt, hasJd: !!input.jd, editable: true };
}

// Self-heal the fit queue. Every candidate parked in `fit_queue` must have an OUTSTANDING fit job
// for the agent to pick up — but the two can drift: a candidate enters fit_queue without a job (the
// legacy watchlist-scan ingest), or a fit result fails to match its candidate so the job ingests
// while the candidate never advances. Either way the Discovery funnel shows work the agent can't
// see. Re-assert the fit job for any such candidate. Idempotent — it keys on the stable
// `fit-<postingId>` id, so repeat calls (every /api/jobs poll) are cheap and can't duplicate.
// The tailor-stage twin is reconcileTailoringQueue.
export function reconcileFitQueue(): number {
  // Common case is an empty fit queue — check that first so a routine /api/jobs poll skips the
  // companies scan entirely.
  const pending = db.select().from(postings).where(eq(postings.state, "fit_queue")).all();
  if (!pending.length) return 0;

  const coById = new Map(db.select().from(companies).all().map((c) => [c.id, c] as const));
  let created = 0;
  for (const cand of pending) {
    const co = coById.get(cand.companyId);
    if (!co) continue;
    const job = db.select().from(jobs).where(eq(jobs.id, fitJobId(cand.id))).get();
    if (job && (job.status === "queued" || job.status === "wip")) continue; // already covered
    createJob({
      id: fitJobId(cand.id),
      type: "fit",
      createdBy: "CoWork",
      task: "Assess fit for the posting below. Use the JD in params if present, else fetch it from the URL; then score per fit.md.",
      params: { postings: [{ id: cand.id, company: co.name, role: cand.title, url: cand.url ?? undefined, jd: cand.jd ?? "" }] },
    });
    created++;
  }
  return created;
}

// The id of an OUTSTANDING (queued or wip) fit job for this posting, or null. One keyed lookup —
// every creator uses the stable `fit-<postingId>` id.
export function outstandingFitJobId(postingId: number): string | null {
  const r = db.select().from(jobs).where(eq(jobs.id, fitJobId(postingId))).get();
  return r && (r.status === "queued" || r.status === "wip") ? r.id : null;
}

// The JD isn't stored on the posting — it lives in the fit job that assessed it. Pull it
// forward so the tailoring job carries the JD instead of making the agent re-fetch from the URL.
// Match by canonical company (+ role when known) across all fit jobs (queued or ingested).
export function findFitJd(company: string, role?: string): string | undefined {
  const wantCo = norm(company);
  const wantRole = norm(role ?? "");
  for (const r of db.select().from(jobs).where(eq(jobs.type, "fit")).all()) {
    for (const fp of (parseParams(r.params).postings as FitPosting[] | undefined) ?? []) {
      if (fp.jd && norm(fp.company ?? "") === wantCo && (!wantRole || norm(fp.role ?? "") === wantRole)) return fp.jd;
    }
  }
  return undefined;
}

// Build the fit re-assessment task for a redo: replay the fit conversation so the agent addresses
// the latest redo request rather than re-scoring from scratch.
function fitRedoTask(p: Posting): string {
  const thread = renderThread(p.redoLog ?? [], "fit");
  const lines = ["Re-assess fit for the posting below per fit.md. Use the JD in params if present, else fetch it from the URL."];
  if (thread) lines.push(`Prior fit conversation (your earlier assessments + my redo requests) — address the latest redo request:\n${thread}`);
  return lines.join("\n");
}

// Queue a fit re-assessment for an already-assessed posting (the redo path). Same stable
// `fit-<postingId>` id as every other fit path: a redo is the newest instruction for that posting,
// so superseding an outstanding fit job is exactly right — the agent must never score it twice.
export function enqueueFitRedo(p: Posting): void {
  const jd = findFitJd(p.company, p.role);
  const redoNote = pendingRedoNote(p.redoLog ?? [], "fit");
  createJob({
    id: fitJobId(p.id),
    type: "fit",
    createdBy: "You",
    task: fitRedoTask(p),
    // redoNote rides on the job for the live "Queued for redo" tag + editable pre-fill (see enqueueTailoring).
    params: { postings: [{ id: Number(p.id), company: p.company, role: p.role, url: p.url, ...(jd ? { jd } : {}) }], ...(redoNote ? { redoNote } : {}) },
    bumpQueuedAt: true, // a fit redo is always a fresh user re-submission → refresh its queued time
  });
}
