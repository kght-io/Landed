import { setConfig, INBOX_SYNCED_KEY } from "../db/config-store";
import {
  ingestInterviewLoop, ingestTailoring, ingestFit, ingestInterviewBrief,
  ingestPeerComp, ingestDiscovered,
  noopIngest, unqueueCandidate, ingestInboxSync, peerCompTask,
} from "./ingest";
import { recordPromptVersion } from "./prompt-stamp";
import type { JobDef, JobType } from "@landed/shared/jobs/types";

// ── the job type table ──
// What kinds of work exist, what the agent is told to do for each, and which ingest body turns its
// result into rows. Deliberately just a table: the implementations live in ./ingest.ts, the
// type-agnostic lifecycle (create, lease, reap, ingest) in ./queue.ts, and WHEN a job gets queued in
// ./enqueue/*. Adding a job type should be a readable entry here plus one ingest function.
//
// Ordered by pipeline stage (ascending): create → scan → fit → tailor → inbox sync.

export const JOB_DEFS: Record<JobType, JobDef> = {
  "watchlist-add": {
    type: "watchlist-add",
    title: "Create Watchlist Entry",
    description: "Research a company (fetch method, target titles) → configure it and add to the watchlist. Leveling is fetched lazily later.",
    playbook: "watchlist-add.md",
    buildTask: (p) =>
      `Research and configure ${p?.company ?? "a company"} — fetch method + target titles — then add it to the watchlist per watchlist-add.md. (Leveling is a separate, lazy job — don't collect it here.)`,
    ingest: noopIngest,
  },
  leveling: {
    type: "leveling",
    title: "Fetch Leveling",
    description: "Pull a company's levels.fyi IC SWE ladder (vs the reference) and store it — queued lazily from the fit view.",
    playbook: "leveling.md",
    buildTask: (p) =>
      `Collect ${p?.company ?? "a company"}'s levels.fyi IC SWE ladder via the Chrome geometry method and store it with upsertCompanies, per leveling.md.`,
    ingest: noopIngest,
  },
  "watchlist-scan": {
    type: "watchlist-scan",
    title: "Scan Watchlist",
    description: "Targeted — check watchlisted companies' boards for new postings → fill 'discovered'.",
    playbook: "watchlist-scan.md",
    buildTask: () =>
      `Watchlist scan: call scanWatchlist, glance every candidate by title + location only (no JD) against my profile, and submit a high/low/drop verdict per posting via submitGlance — high auto-queues a fit job. Follow watchlist-scan.md.`,
    ingest: ingestDiscovered("watchlist-scan"),
  },
  fit: {
    type: "fit",
    title: "Assess Job Fit",
    description: "Score fit + draft a tailoring brief for discovered postings.",
    playbook: "fit.md",
    buildTask: () => `Assess fit for the postings in this job using my base resume; write the result per fit.md.`,
    ingest: ingestFit,
    // Un-queued → back to `review`, the Scan Watchlist triage list where it awaits your decision.
    onUnqueue: ({ postingId }) =>
      unqueueCandidate(postingId, { from: "fit_queue", to: "review", source: "discovery", label: "fit" }),
    redoPhase: "fit",
    promptFeature: "fit",
    afterIngest: (ctx) => recordPromptVersion(ctx, "fit"),
  },
  tailoring: {
    type: "tailoring",
    title: "Tailor Resume For a Job",
    description: "Tailor a resume per posting (postings in the 'tailoring' stage) and save it.",
    playbook: "tailoring.md",
    buildTask: () =>
      `Tailor resumes for postings in the 'tailoring' stage (see the listApplications MCP tool). For each, read its JD, tailor the base resume, save to resume/<slug>/, and report the result via submitJobResult per tailoring.md.`,
    ingest: ingestTailoring,
    // Only a FIRST-TIME tailor parks the posting in `tailoring` with no resume yet (the funnel shows
    // "Queued for tailoring…"), so only that one gets un-queued — to `assessed`, its pre-tailor stage.
    // A redo's posting is already `tailored` and keeps its resume; the guard leaves it alone.
    onUnqueue: ({ postingId }) =>
      unqueueCandidate(postingId, { from: "tailoring", to: "assessed", source: "tailoring", label: "tailoring", guard: (c) => !c.resumeDir }),
    redoPhase: "tailor",
    promptFeature: "tailoring",
    afterIngest: (ctx) => recordPromptVersion(ctx, "tailor"),
  },
  "inbox-sync": {
    type: "inbox-sync",
    title: "Sync Inbox",
    description: "Read job email → update application statuses, interviews, and dates.",
    playbook: "inbox-sync.md",
    // `since` is a UNIX epoch in seconds — name it as the literal `after:` operand so the agent
    // pastes it straight into searchGmail instead of trying to render it as a readable date.
    buildTask: (p) =>
      `Audit my Gmail for job-application emails matching \`after:${p?.since ?? "<the last sync>"}\` and write the result per inbox-sync.md.`,
    // `approval`: an inbox sync never edits the tracker directly — every change it derives from your
    // mail is parked for you to approve on the Changes page.
    ingest: ingestInboxSync,
    // Advance the sync watermark now the result is in the DB — this is the only writer of
    // `inbox_last_synced`, which inboxSyncSince() reads to build the next run's search window.
    afterIngest: ({ ingestedAt }) => setConfig(INBOX_SYNCED_KEY, ingestedAt),
  },
  "interview-brief": {
    type: "interview-brief",
    title: "Interview brief",
    description: "Synthesize a versioned interview brief (role, TC, next step, gaps-to-prep) from a company's interview-prep asset folder.",
    playbook: "interview-brief.md",
    buildTask: (p) => {
      const slug = p?.slug ?? "<slug>";
      const who = [p?.company, p?.role].filter(Boolean).join(" — ") || "this posting";
      return (
        `Generate an interview brief for ${who}. Read everything already dumped under \`interview-prep/${slug}/\`: ` +
        `\`context.md\`, every file in \`transcripts/\`, \`emails.md\`, and \`attachments/\`. Synthesize a SOURCE-TAGGED ` +
        `brief — for role, tc (total comp), team, and expectations prefer the first recruiter call transcript, else fall ` +
        `back to the JD, tagging each \`source\` ("recruiter" | "jd"); tag every gap and the next step "recruiter" (said ` +
        `directly) vs "online" (inferred from research). Submit ONE record via submitJobResult(type:"interview-brief") shaped ` +
        `{ id: ${p?.id ?? "<postingId>"}, role:{text,source}, tc:{text,source}, team:{text,source}, expectations:{text,source}, ` +
        `nextStep:{text,source}, gaps:[{area,why,severity,source}], summary, materials:[...] } per interview-brief.md.`
      );
    },
    ingest: ingestInterviewBrief,
  },
  "interview-emails": {
    type: "interview-emails",
    title: "Pull interview emails",
    description: "Capture a company's interview emails (recruiter outreach, scheduling, what-to-expect, comp) as one record per email, download their attachments, and report the structured interview loop (who · when · format · what to expect) onto the posting. Does NOT touch application status (global inbox-sync owns that).",
    playbook: "interview-emails.md",
    // Owns the round's SUBSTANCE + the captured mail. See ingestInterviewLoop.
    buildTask: (p) => {
      const slug = p?.slug ?? "<slug>";
      const co = p?.company ?? "the company";
      const since = p?.since ? ` after:${p.since}` : " newer_than:3m";
      const id = p?.id ?? "<posting id>";
      return (
        `Capture the interviewing emails for ${co}. searchGmail with a query like \`"${co}"${since}\` (also try the ` +
        `recruiter's domain) and read the interviewing-relevant threads via getGmailThread. For every thread that ` +
        `carries a file (role PDF, prep guide, take-home), call downloadGmailAttachments(id, "${slug}") to save it into ` +
        `\`interview-prep/${slug}/attachments/\`. Then submit ONE record via submitJobResult(type:"interview-emails") shaped ` +
        `{ id: ${id}, emails: [...], rounds: [...] }. \`emails\`: ONE entry per email (not per thread) with threadId, ` +
        `messageId, subject, from, to, date, round (when it's about one), attachments, and body — the message text kept ` +
        `substantially verbatim, signatures and quoted replies trimmed, NOT summarized. Do NOT write emails.md: the app ` +
        `regenerates it from these records. \`rounds\`: one entry per round, chronological, with round, stage, kind, date, ` +
        `startTime, durationMins, timezone, format, joinUrl, interviewers [{name,title}], whatToExpect (prose — what they ` +
        `said the round IS), and prepNotes (their how-to-prepare list). Omit any field you didn't verify; omitted fields ` +
        `keep what's stored. Do NOT change application status (global inbox-sync owns that). Follow interview-emails.md.`
      );
    },
    ingest: ingestInterviewLoop,
  },
  "peer-comp": {
    type: "peer-comp",
    title: "Peer comp comparison",
    description: "Research + synthesize a compensation comparison across every role being actively interviewed for. Global (not tied to a posting) — the latest run is stored and shown in the Compare comp popup.",
    playbook: "peer-comp.md",
    hidden: true,
    buildTask: peerCompTask,
    ingest: ingestPeerComp,
  },
};

export const jobDef = (type: string): JobDef | null => (JOB_DEFS as Record<string, JobDef>)[type] ?? null;

