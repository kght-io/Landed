// The pipeline spine — the single source of truth for the home Pipeline page's stages, drawn as the
// arrow-ribbon funnel (frontend/components/Pipeline.tsx). `turn` = whose move it is: you = your decision,
// cowork = waiting on the agent, done = graduated to the tracker, archive = dropped.
// A step spans one or more `states`: pre-apply steps over candidate scan-store states (Fit
// Assessment = fit_queue + assessed; Tailor Resume = tailoring + tailored; Apply Later = apply_later)
// summed from /api/scanned?state=<states>; tracker steps over Posting statuses (filtered via pipeline/stages columnOf).
export type Turn = "you" | "cowork" | "done" | "archive";
export type SpineStep = { key: string; label: string; turn: Turn; states: string[]; hint?: string };

// The full pipeline, left → right. The first three steps are pre-apply candidate stages backed by
// the scan store (/api/scanned); the last three are tracker stages backed by `postings` (the
// applications table). A tracker step's `states` are the Posting statuses that roll into it (same
// grouping as pipeline/stages columnOf), so the funnel can filter postings by status per step.
export const DISCOVERY_SPINE: SpineStep[] = [
  // Note: the watchlist/scan-setup + the scan-results TRIAGE (states `matched`/`review`) live on the
  // /watchlist route now — you add scan results to Fit from the Watchlist page's "Scan results" tab.
  // So Fit Assessment shows only what's actually queued/scored (fit_queue → assessed).
  { key: "fit", label: "Fit Assessment", turn: "cowork", states: ["fit_queue", "assessed"], hint: "The agent scores queued postings; then tailor / apply / save" },
  { key: "tailor", label: "Tailor Resume", turn: "cowork", states: ["tailoring", "tailored"], hint: "The agent tailors a resume — then apply" },
  { key: "later", label: "Apply Later", turn: "you", states: ["apply_later"], hint: "Ready to submit — parked here until you apply" },
  { key: "applied", label: "Applied", turn: "done", states: ["applied"], hint: "Submitted — awaiting a response" },
  { key: "interview", label: "Interviewing", turn: "done", states: ["interview", "offer"], hint: "In the loop — interviews and offers" },
  { key: "closed", label: "Closed", turn: "done", states: ["accepted", "rejected", "ghost", "withdrawn", "company_skipped", "expired"], hint: "Outcome reached" },
];

export const DISCOVERY_ARCHIVE: SpineStep[] = [
  { key: "dismissed", label: "Discarded", turn: "archive", states: ["dismissed"], hint: "Dropped at a glance / triage" },
  { key: "filtered", label: "Filtered", turn: "archive", states: ["filtered"], hint: "Rejected by the coarse pre-filter (never glanced)" },
];

// Total candidates in a pre-apply step — summed across its member scan-store states.
export const stepCount = (step: SpineStep, counts: Record<string, number> | null | undefined): number =>
  step.states.reduce((n, s) => n + (counts?.[s] ?? 0), 0);

// Every step the pipeline can show — the spine plus the archive steps (reachable, but off the ribbon).
export const ALL_STEPS: SpineStep[] = [...DISCOVERY_SPINE, ...DISCOVERY_ARCHIVE];
// The step a first-time visitor lands on.
export const DEFAULT_STEP = "fit";

// The active step is persisted, so leaving the page and coming back lands on the step you left. It
// MUST resolve from the stored value synchronously (before the first render): a step restored later,
// in a mount effect, makes the page fetch the DEFAULT step's rows first and land that response in
// the restored step's table. Anything unrecognized (a step that no longer exists, a corrupt value)
// falls back to the default.
export const resolveStep = (stored: unknown): string =>
  typeof stored === "string" && ALL_STEPS.some((s) => s.key === stored) ? stored : DEFAULT_STEP;

// The scan-store states a step spans — what `/api/scanned?state=` is asked for. An unrecognized key
// stands for itself, so a single-state step needs no entry.
export const stepStatesFor = (key: string): string[] => ALL_STEPS.find((s) => s.key === key)?.states ?? [key];

// "Move to…" jumps a posting straight to any stage, OUT of sequence — surfaced in the ⋯ menu on every
// row (e.g. send a fresh match straight to Applied). Each target is a stage's canonical landing
// state; a row's own stage is hidden from its menu (see Pipeline's STATE_STAGE). One PATCH to the
// unified posting endpoint handles the move in any stage; the matching side effects mirror the
// drawer's selector (stamp the applied date, flag interviewed).
//
// Lives HERE, beside the spine, because the two must agree: a target whose `state` isn't one of its
// `stage`'s states sends the row to a step that won't show it. That's not hypothetical — "Fit
// assessment" pointed at `review` for a month after 720bdbb moved triage off the Fit step onto
// /watchlist, so the move silently evicted postings from the pipeline. `move-targets.test.ts`
// pins the invariant.
export type MoveTarget = { label: string; state: string; stage: string };
export const MOVE_TARGETS: MoveTarget[] = [
  { label: "Fit assessment", state: "fit_queue", stage: "fit" },
  { label: "Tailor resume", state: "tailoring", stage: "tailor" },
  { label: "Apply later", state: "apply_later", stage: "later" },
  { label: "Applied", state: "applied", stage: "applied" },
  { label: "Interviewing", state: "interview", stage: "interview" },
  { label: "Rejected", state: "rejected", stage: "closed" },
  { label: "Discarded", state: "dismissed", stage: "dismissed" },
];
