import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { jobs, postings, companies, prepCompany } from "../../db/schema";
import type { PostingRow } from "../../db/schema";
import { getPosting } from "../../db/queries";
import { canonical } from "@landed/shared/agents/canonical";
import { exportPrepContextFor, exportQuestionsFor } from "../../prep/export-context";
import { createJob } from "../queue";
import { enqueueInboxSync } from "./inbox";
import type { Posting } from "@landed/shared/types";

// Interview prep: prep-research, interview briefs, interview emails, and peer comp.
//
// Part of the jobs/ split: this file owns WHEN a job of this kind is queued (and what it carries).
// The type-agnostic lifecycle — claim, lease, reap, ingest — lives in ../queue.ts.

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
