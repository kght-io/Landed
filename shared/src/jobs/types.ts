import type { ReconcileResult } from "../agents/types";

export type JobType =
  | "watchlist-add"
  | "leveling"
  | "watchlist-scan"
  | "inbox-sync"
  | "fit"
  | "tailoring"
  | "prep"
  | "prep-research"
  | "leetcode-add"
  | "interview-brief"
  | "interview-emails"
  | "peer-comp";

// What the app (or the agent) drops into agent-jobs/queue/<id>.json.
export type JobFile = {
  id: string;
  type: JobType;
  createdBy: "You" | "CoWork"; // who initiated it — same two actors as the change log
  createdAt: string;
  playbook: string; // e.g. "inbox-sync.md" under instructions/
  output: string; // e.g. "results/<id>.json" (relative to agent-jobs/)
  task: string; // human/the agent-readable instruction
  params?: Record<string, unknown>;
};

// The agent result file: a shared envelope, per-type records. Mirrors the input model
// (generic envelope + typed params) so the output side is just as flexible.
//   agent-jobs/results/<id>.json → { type, results: [ <type-specific record> ] }
export type ResultRecord = Record<string, unknown>;
export type JobResult = { jobId?: string; type?: JobType; results: ResultRecord[] };

// The fit handoff queue (the "awaiting the agent" side of the Fit Assessment column).
export type FitQueueItem = {
  jobId: string;
  company: string;
  role?: string;
  url?: string;
  createdBy: string; // cowork | you | app
  createdAt: string;
  hasJd: boolean;
  editable: boolean; // single-posting jobs can be edited in place
};

// What your "+ add" / edit form submits for a fit job.
export type FitInput = { company: string; role?: string; jd: string; url?: string };

// Per-type definition: its the agent playbook + how its result records reconcile into the DB.
export type JobDef = {
  type: JobType;
  title: string;
  description: string;
  playbook: string; // instructions/<playbook>
  buildTask: (params?: Record<string, unknown>) => string;
  // dryRun: compute the changes without persisting (powers the preview)
  ingest: (records: ResultRecord[], dryRun?: boolean) => ReconcileResult;
  hidden?: boolean; // keep the def (ingest/queue machinery) but omit from the agent Jobs list
};
