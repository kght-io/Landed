import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { jobs, postings, companies } from "../../db/schema";
import type { PostingRow } from "../../db/schema";
import { getPosting } from "../../db/queries";
import { canonical } from "@landed/shared/agents/canonical";
import { exportPrepContextFor } from "../../prep/export-context";
import { createJob } from "../queue";
import { enqueueInboxSync } from "./inbox";

// Interview prep: interview briefs, interview emails, and peer comp.
//
// Part of the jobs/ split: this file owns WHEN a job of this kind is queued (and what it carries).
// The type-agnostic lifecycle — claim, lease, reap, ingest — lives in ../queue.ts.
//
// Part of the jobs/ split: this file owns WHEN a job of this kind is queued (and what it carries).
// The type-agnostic lifecycle — claim, lease, reap, ingest — lives in ../queue.ts.

// Auto-queue the brief the first time a posting reaches the interview stage. Skipped when a brief
// job already exists for it — re-entering the stage (offer → interview, a corrected status) must not
// supersede a brief that already ran, and the manual "Generate brief" button is how you ask for a
// fresh one. Best-effort: this rides on someone else's status write and must never break it.
export function maybeQueueInterviewBrief(postingId: number, beforeStatus: string | null | undefined, afterStatus: string): void {
  try {
    if (afterStatus !== "interview" || beforeStatus === "interview") return;
    if (db.select().from(jobs).where(eq(jobs.id, `interview-brief-${postingId}`)).get()) return; // queued or already ran
    enqueueInterviewBrief(postingId, { createdBy: "CoWork" });
  } catch {
    // queueing a brief must never break the status update that triggered it
  }
}

// (Re)queue an interview-brief job for one posting — The agent reads that company's interview-prep
// asset folder (context.md + dropped transcripts + fetched emails) and returns a versioned brief.
// Deterministic id `interview-brief-<postingId>` so the drawer's "Generate" button re-runs cleanly
// (createJob supersedes the prior run). Params carry the posting id (the ID-only ingest key), the
// company/role, and the folder slug so the task can point at interview-prep/<slug>/. Returns the
// job id + slug (or null if the posting is gone).
export function enqueueInterviewBrief(appId: number, opts: { createdBy?: "You" | "CoWork" } = {}): { jobId: string; slug: string | null } | null {
  const p = getPosting(appId);
  if (!p) return null;
  const slug = canonical(p.company)?.key ?? null;
  // Refresh the folder as part of queuing: this job's whole input is what's on disk, so a brief built
  // from a digest older than the rows it claims to summarize is worse than no brief. Best-effort —
  // a failed dump must not stop the job being queued against whatever is already there.
  if (slug) { try { exportPrepContextFor(slug); } catch { /* the job runs on the existing dump */ } }
  const jobId = createJob({
    id: `interview-brief-${appId}`,
    type: "interview-brief",
    createdBy: opts.createdBy ?? "You",
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
    // `id` is the posting the captured loop lands on — the job's ingest is ID-only, so without it
    // the agent has nothing to echo back and its rounds would park as an unbound alert.
    params: { id: appId, company: p.company, ...(slug ? { slug } : {}), since },
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
// representative posting): refreshes its on-disk context.md NOW and (re)queues the interview-emails
// job EVERY time. Pure orchestration over the existing enqueue helpers. Returns counts.
export function updateInterviewStatus(): {
  inboxSync: boolean;
  companies: number;
  foldersRefreshed: number;
  emailsQueued: number;
} {
  // 0. Global inbox-sync — once. Skip if one is already queued/wip so clicks don't stack duplicates.
  const inboxOutstanding = !!db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, "inbox-sync"), inArray(jobs.status, ["queued", "wip"])))
    .get();
  let inboxSync = false;
  if (!inboxOutstanding) {
    enqueueInboxSync({ createdBy: "You" });
    inboxSync = true;
  }

  // Active interview/offer postings, deduped to one representative posting per company.
  const byCompany = new Map<number, PostingRow>();
  for (const row of db.select().from(postings).where(inArray(postings.state, ["interview", "offer"])).all()) {
    if (!byCompany.has(row.companyId)) byCompany.set(row.companyId, row);
  }

  let foldersRefreshed = 0;
  let emailsQueued = 0;
  for (const [companyId, row] of byCompany) {
    const co = db.select().from(companies).where(eq(companies.id, companyId)).get();
    const slug = co ? canonical(co.name)?.key ?? null : null;
    // 1. Refresh the asset folder now (best-effort — must never break the rest of the fan-out).
    if (slug) {
      try {
        exportPrepContextFor(slug);
        foldersRefreshed++;
      } catch {
        // a bad dump for one company shouldn't abort the others
      }
    }
    // 2. Pull interview emails — every time.
    if (enqueueInterviewEmails(row.id)) emailsQueued++;
  }

  return { inboxSync, companies: byCompany.size, foldersRefreshed, emailsQueued };
}
