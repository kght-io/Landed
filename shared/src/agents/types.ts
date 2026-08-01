import type { EmailRefs, InterviewRound, Status } from "../types";

// A normalized application record produced by any source (CSV, Gmail, scraper).
// Statuses are already mapped to our enum; company canonicalization happens in reconcile.
export type IncomingApp = {
  company: string;
  role?: string;
  level?: string;
  team?: string;
  location?: string;
  status: Status;
  interviewed?: boolean;
  channel?: "direct" | "referral";
  source?: string;
  url?: string;
  note?: string;
  appliedDate?: string;
  updatedAt?: string;
  needsReview?: boolean;
  // Interview rounds parsed from scheduling/outcome emails (inbox-sync). Reconcile upserts these
  // into the `interviews` table for the matched/created posting. Idempotent on (posting, round).
  interviews?: InterviewRound[];
  // Gmail thread ids per stage (inbox-sync), merged onto the posting for direct email links.
  emailRefs?: EmailRefs;
};

// A single change an ingest/reconcile would make — drives the change log + the preview.
export type ChangeDetail = { action: string; summary: string };

// What reconcile did, for the change log + the agent run summary.
export type ReconcileResult = {
  inserted: number;
  updated: number;
  fieldChanges: number;
  flagged: number;
  pending: number; // ambiguous matches parked for human approval
  newCompanies: number;
  // Records that never reached a group because their company wouldn't canonicalize. Counted rather
  // than dropped in silence — otherwise a run that lost records reports the same "nothing new" as a
  // run that genuinely found none. Optional because only reconcile() groups by company; the
  // id-matched ingests (fit, tailoring, peer-comp, …) have no way to skip.
  skipped?: number;
  summary: string;
  details?: ChangeDetail[]; // per-row, for the preview
};

// Note: the app and the agent communicate only through files in agent-jobs/ (queue →
// results → done) plus the exported context files — there is no in-process agent call.
// Job definitions live in backend/src/jobs/registry.ts; reconcile() is the one door results
// come through. (A direct-API Agent.run() model used to live here; it was retired.)
