// Core domain model for the job-hunt pipeline.
// Foundation phase: this drives the UI from in-memory state. Plumbing (SQLite,
// scrapers, AI fit scoring, bundle export) gets wired behind these same shapes later.

import type { Leveling } from "./config/leveling";
import type { DiffOp } from "./util/linediff";

// Company tier, best → broadest. Stored as stable slugs (tier1/tier2/tier3); human labels
// live in TIER_META (pipeline/stages.ts). tier1 = top target, tier3 = the broad practice pool.
export type Tier = "tier1" | "tier2" | "tier3";

// The pipeline stages, left-to-right. tier3 (practice) postings can jump straight
// from "discovered" to "applied" (mass apply, no human gate).
export type Status =
  | "discovered" // freshly scraped, untouched
  | "assessed" // fit note generated, awaiting your decision
  | "tailoring" // bundle exported, being tailored (in the agent)
  | "applied" // submitted
  | "interview" // reached an interview
  | "offer" // received an offer
  | "accepted" // accepted an offer
  | "rejected"
  | "ghost" // applied, no response
  | "withdrawn" // you pulled out after applying
  | "company_skipped" // you passed on the company (a company-level decision; renders skipped at the company)
  | "expired"; // the req/JD closed before an outcome (posting pulled, not your decision)

export const STATUS_ORDER: Status[] = [
  "discovered",
  "assessed",
  "tailoring",
  "applied",
  "interview",
  "offer",
  "accepted",
  "rejected",
  "ghost",
  "withdrawn",
  "company_skipped",
  "expired",
];

// Structured fit assessment from the agent — detailed, not surface-level. Stored as a JSON
// blob (applications.fit_detail) and parsed onto the posting.
export type FitGap = { text: string; severity?: "hard" | "soft"; detail?: string };
export type FitAssessment = {
  levelMatch?: { call?: string; why?: string }; // call: match | stretch | under-leveled
  recommendation?: string; // tailor | apply | skip
  summary?: string;
  strengths?: string[];
  gaps?: FitGap[];
};

// One turn in a posting's redo conversation — the alternating agent⇄user thread that powers
// "redo with a note". Seeded by the agent's first result, then a user redo note, then the agent's
// next versioned result, and so on. Each agent turn IS a version; the live fields (fitScore/
// fitDetail/resumeDir) project the latest agent turn while the full history lives here.
export type RedoPhase = "fit" | "tailor";
export type RedoTurn = {
  phase: RedoPhase;
  role: "agent" | "user";
  at: string; // ISO timestamp
  text: string; // agent: what changed / the fit summary · user: the redo instruction
  version?: number; // agent turns only — the version this attempt produced (v1, v2, …)
  slug?: string; // tailor agent turns — the resume/<slug>/ folder for this version
  diff?: DiffOp[]; // tailor agent turns — the agent's annotated tailored-vs-base diff (each changed line + why)
  fitScore?: number; // fit agent turns
  fit?: FitAssessment; // fit agent turns — the full snapshot for this version
};

// The interview brief — a versioned overview the agent generates from the interview-prep asset
// folder (context.md + call transcripts + pulled emails + attachments). Each generation appends a
// new version to postings.interview_briefs; the drawer renders the latest and lets you switch
// versions.
//
// Source provenance: facts and gaps carry where they came from so you can tell what a human
// confirmed vs what's inferred. `recruiter` = the first recruiter call transcript or recruiter
// emails; `jd` = the job description (the fallback when the recruiter didn't say); `online` =
// prep-research / public sources.
export type BriefSource = "recruiter" | "jd" | "online";
// A single fact plus where it came from. `tc` is a free-text total-comp line (not a numeric field).
export type SourcedText = { text: string; source?: BriefSource };
export type BriefGap = { area: string; why?: string; severity?: "high" | "medium" | "low"; source?: BriefSource };
export type InterviewBrief = {
  version: number; // 1-based; increments per generation (like a RedoTurn version)
  generatedAt: string; // ISO
  role?: SourcedText; // the role as understood (recruiter call → JD fallback)
  tc?: SourcedText; // total-comp line (recruiter call → JD fallback)
  team?: SourcedText; // team / product / who they build for
  expectations?: SourcedText; // what they're looking for in the candidate
  nextStep?: SourcedText; // the immediate next step in the loop
  gaps?: BriefGap[]; // key gaps to prep, each tagged recruiter (said directly) vs online (inferred)
  summary?: string; // short overview paragraph
  materials?: string[]; // which materials fed this version (e.g. "recruiter transcript", "JD", "2 emails")
};

// The peer-comp comparison — one generated markdown artifact (the 6-column table + synthesis across
// the roles you're actively interviewing for). GLOBAL and latest-only: generated inline from your
// stored data (a direct Claude call) and kept as the latest in app_config.
export type PeerComp = {
  generatedAt: string; // ISO
  markdown: string; // the full comparison table + synthesis, as markdown (GFM)
};

// One interview round in the "interviewing" stage — extracted from inbox-sync (scheduling /
// outcome emails) into the `interviews` table, one row per round. `kind` is a coarse type so the
// drawer can label and order rounds; `outcome` drives the current/upcoming highlight.
export type InterviewKind =
  | "recruiter_screen"
  | "phone_screen"
  | "technical"
  | "system_design"
  | "behavioral"
  | "onsite"
  | "hiring_manager"
  | "final"
  | "other";

// Who you're meeting in a round. `title` is whatever the email signature / scheduling mail gave.
export type Interviewer = { name: string; title?: string };

export type InterviewRound = {
  id?: number;
  round?: number; // 1-based order within the loop (sort key)
  // The recruiter's own name for the block this round sits in ("Technical Assessment"). Consecutive
  // rounds that share one become a single stage in the drawer; absent, same-day rounds group instead.
  stage?: string;
  kind?: InterviewKind;
  date?: string; // ISO date (scheduled or completed)
  outcome?: "passed" | "rejected" | "pending"; // pending = scheduled/upcoming
  notes?: string;
  emailId?: string; // Gmail thread id for this round's email (inbox-sync) — enables a direct link
  // --- the round's substance, captured by `interview-emails` from the scheduling/prep threads.
  // inbox-sync (the cheap global pass) owns the fields above and leaves these alone; each writer
  // omits what it doesn't know, and upsertInterviews preserves an omitted field. See the drawer's
  // "Up next" card, which is entirely built from these.
  startTime?: string; // local wall-clock "HH:MM" the round starts
  durationMins?: number;
  timezone?: string; // as the email stated it ("ET") — not normalized, so it can't be silently wrong
  interviewers?: Interviewer[];
  format?: string; // "Zoom video, shared screen" / "audio-only, 20–30 min"
  joinUrl?: string;
  whatToExpect?: string; // what they said the round IS — the prose worth reading before it
  prepNotes?: string[]; // their how-to-prepare list, one item per line
  attachments?: string[]; // files this round's thread carried, as saved under interview-prep/<slug>/attachments/
};

// Gmail thread ids for the email that drove each tracker stage (captured by inbox-sync), so the
// tracker can deep-link straight to the message instead of a search.
export type EmailRefs = { applied?: string; rejected?: string; offer?: string; interview?: string };

// A personal comment You leaves on a posting (distinct from `note`, which is shared with
// The agent/historical sync). Stored as a JSON array on the posting; the funnel shows a count + popover.
export type Comment = { text: string; at: string; editedAt?: string }; // at = created, editedAt = last edit (ISO timestamps)

export type Posting = {
  id: string;
  company: string;
  tier: Tier;
  watchlist?: boolean; // company is on the discovery watchlist (auto-scanned) — denormalized from the company
  cooldownUntil?: string | null; // company is skipped by discovery until this date — denormalized from the company
  role: string;
  location?: string;
  url?: string;
  source?: string; // greenhouse | lever | ashby | netflix | manual | ...
  fitScore?: number; // 0-100, quick badge/sort
  fit?: FitAssessment; // the detailed assessment (parsed from fit_detail)
  status: Status;
  channel?: "direct" | "referral";
  interviewed?: boolean; // reached an interview → drives reapply cooldown after rejection
  needsReview?: boolean; // flagged by an automated source — awaits your confirm
  pinned?: boolean; // user-pinned → floats to the top of its stage table
  resumeDir?: string; // per-app tailoring folder (latest version), e.g. acme-senior-123/v2
  chosenResume?: string | null; // the résumé chosen to submit: "base" or a version slug (null = undecided)
  editedResumes?: string[]; // version slugs you've manually edited by hand (per-version flag)
  redoLog?: RedoTurn[]; // the fit/tailor redo conversation + version history
  leveling?: Leveling; // the company's levels.fyi ladder (for the Lvl chip)
  discoveredAt?: string; // ISO date
  appliedDate?: string;
  updatedAt?: string;
  note?: string; // freeform, also catches messy historical data
  comp?: string; // interview-stage intel: comp structure (funding/runway, base, bonus, equity) — markdown
  teamNotes?: string; // interview-stage intel: team / product / work / role focus — markdown
  comments?: Comment[]; // your personal comment thread on this posting (separate from `note`)
  history?: boolean; // true = imported from the old tracker.csv
  interviews?: InterviewRound[]; // interview-stage rounds (from inbox-sync), ordered by round
  emailRefs?: EmailRefs; // Gmail thread ids per stage (inbox-sync) — for direct email links
  interviewBriefs?: InterviewBrief[]; // versioned interview briefs (the agent-generated), oldest → newest
};
