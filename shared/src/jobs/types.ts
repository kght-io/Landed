import type { ReconcileResult } from "../agents/types";
import type { RedoPhase } from "../types";

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

  // ── Per-type side effects the generic queue can't know about ──
  // Post-ingest bookkeeping that writes OUTSIDE this ingest's own domain and needs the job row's
  // context — its params, or the moment the result landed — neither of which `ingest` receives.
  // Fires exactly once per job: never on a dry run, never for an already-ingested job, and never
  // for one nobody holds a live claim on (submitJobResult returns/throws before reaching it).
  afterIngest?: (ctx: {
    jobId: string;
    params: Record<string, unknown>;
    ingestedAt: string;
    records: ResultRecord[];
    result: ReconcileResult;
  }) => void;
  // Undo what QUEUEING this type did outside the `jobs` table. Queuing a fit/tailoring job also
  // parks its posting in a waiting stage, and the self-heal reconcilers re-create a job for any
  // posting left parked there — so without this, deleting the job quietly undoes itself on the
  // next /api/jobs poll.
  onUnqueue?: (ctx: { jobId: string; params: Record<string, unknown>; postingId: number | null }) => void;
  // This type produces a versioned artifact you can ask the agent to redo. Deleting its queued job
  // drops the trailing pending user turn from the posting's conversation, so the "Queued for redo"
  // tag clears instead of dangling.
  redoPhase?: RedoPhase;
};
