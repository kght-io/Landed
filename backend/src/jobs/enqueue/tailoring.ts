import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { jobs, postings, companies } from "../../db/schema";
import { logEvent, getPosting } from "../../db/queries";
import { slugFor } from "../../config";
import { parseRedoLog, nextVersion, renderThread, hasPendingRedo, pendingRedoNote, pendingUserIndex } from "@landed/shared/jobs/redolog";
import { createJob, now, dropPendingRedoNote } from "../queue";
import { enqueueFitRedo, findFitJd } from "./fit";
import type { Posting, RedoPhase, RedoTurn } from "@landed/shared/types";

// tailoring: per-posting resume versions, the redo conversation, and the tailor-queue self-heal.
//
// Part of the jobs/ split: this file owns WHEN a job of this kind is queued (and what it carries).
// The type-agnostic lifecycle — claim, lease, reap, ingest — lives in ../queue.ts.

// Keep the tailoring queue in sync with a posting's stage. When a posting enters "Queued"
// (status `tailoring`, no resume slug) we queue a tailoring job; when it leaves we drop the
// still-pending one (an already-ingested row stays as history). Deterministic per posting id.

// Cascade-delete for a HARD-DELETED posting: drop its tailoring job whatever state it's in.
// Deliberately NOT deleteQueuedJob — that one only matches queued/stale-lease rows, so a live `wip`
// job would survive its posting and send an agent off to tailor a resume for something that no
// longer exists. Its un-queue and redo-note hooks are no-ops here anyway: the posting is already
// gone by the time this runs (see DELETE /api/applications/:id).
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
    if (existing && existing.status === "queued" && !keepRedo && !opts?.keepPending) {
      db.delete(jobs).where(eq(jobs.id, id)).run();
      // The job we just dropped may have been a redo — take its pending note with it, or the
      // conversation keeps a request the queue no longer reflects (see dropPendingRedoNote).
      dropPendingRedoNote(Number(p.id), "tailor");
    }
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
