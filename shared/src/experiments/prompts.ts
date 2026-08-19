// Prompt experiments: does changing HOW fit is judged, or how a résumé is tailored, actually change
// how often a human replies? Pure functions over one row per application — no DB, no dates from the
// clock — so the classification is testable and the backend only has to supply rows.
//
// Deliberately stops at classifying ONE application. There is no aggregation here yet: with the
// first stamped runs still landing, it is too early to know which cuts of this data are the useful
// ones, so the view lists the rows and leaves the summarizing for when the question is clearer.
//
// Everything here is deliberately conservative about calling something a failure. The dataset is
// small (tens of applications, not thousands) and the failure mode that matters is reading noise, or
// your own decisions, as evidence that a prompt is worse.

import type { PromptFeature } from "../db/enums";

export type { PromptFeature };

// What a single application says about the prompt that produced it.
//   callback    — a human engaged: a screen, a loop, an offer (even if it later ended in a no)
//   no_callback — a decision arrived, or the wait ran out
//   pending     — applied too recently for silence to mean anything yet
//   excluded    — never applied, or YOU closed it (withdrawn / expired). Not the prompt's outcome.
export type Outcome = "callback" | "no_callback" | "pending" | "excluded";

// How long silence is given the benefit of the doubt. Three weeks is past the point where most
// screens land, and short enough that a version's verdict isn't a quarter away.
export const CALLBACK_WINDOW_DAYS = 21;
// The bar a version has to clear before a callback RATE is worth computing at all. Nothing aggregates
// yet — the view shows raw rows — but the number belongs with the rules it qualifies: a rate over a
// handful of applications is noise wearing a number.
export const MIN_DECIDED_FOR_RATE = 10;

export type AppliedRow = {
  postingId: number;
  appliedAt: string | null; // YYYY-MM-DD or ISO; null = never submitted
  state: string;
  interviewed: boolean;
  fitScore: number | null;
  fitPromptVersionId: number | null; // null = ran before versioning — the baseline cohort
  tailorPromptVersionId: number | null; // null = untailored, or pre-versioning
};

// Which states mean an application was actually submitted, and which mean an offer. Shared with
// db/dashboard.ts rather than copied: two definitions of "what counts as a callback" would drift,
// and then two screens would disagree about the same applications.
export const APPLIED_STATES = new Set(["applied", "interview", "offer", "accepted", "rejected", "ghost", "withdrawn"]);
export const OFFER_STATES = new Set(["offer", "accepted"]);
// You closed these yourself. Counting them as failures would charge your own decisions to whichever
// prompt happened to be active that week.
const SELF_CLOSED_STATES = new Set(["withdrawn", "expired"]);
// You marked it dead. That's a decision, so it doesn't wait out the window.
const NO_RESPONSE_STATES = new Set(["ghost"]);

// How deep into the loop an application got. The binary callback is `>= 1`; keeping the ladder
// explicit is the seam for reporting screen / onsite / offer rates later without re-deriving
// anything — a new selector over the same function, not a new rule.
function stageReached(row: AppliedRow): 0 | 1 | 2 | 3 {
  if (OFFER_STATES.has(row.state)) return 3;
  if (row.state === "interview" || row.interviewed) return 1;
  return 0;
}

// Bare YYYY-MM-DD is pinned to UTC — a local parse shifts the day and can flip a row across the
// window edge. Same normalization db/dashboard.ts uses for its buckets.
function daysSince(appliedAt: string, now: Date): number {
  const iso = appliedAt.length === 10 ? `${appliedAt}T00:00:00Z` : appliedAt;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - t) / 86_400_000;
}

export function callbackOutcome(row: AppliedRow, now: Date): Outcome {
  // Engagement is checked BEFORE any closing state: `state` holds only the latest value, so a loop
  // that ended in a rejection still reads as "rejected". Reading that as a failure would delete most
  // of the positive signal.
  if (stageReached(row) >= 1) return "callback";
  if (SELF_CLOSED_STATES.has(row.state)) return "excluded";
  if (!row.appliedAt || !APPLIED_STATES.has(row.state)) return "excluded";
  if (NO_RESPONSE_STATES.has(row.state) || row.state === "rejected") return "no_callback";
  return daysSince(row.appliedAt, now) >= CALLBACK_WINDOW_DAYS ? "no_callback" : "pending";
}

// ── Fit bands ───────────────────────────────────────────────────────────────────────────────
// Two applications with the same fit score are roughly the same opportunity, so banding by score is
// how you'd eventually compare tailoring prompts without the comparison being driven by which jobs
// happened to be in the batch.
export type FitBucket = "80+" | "60-79" | "40-59" | "<40" | "unscored";
export function fitBucket(score: number | null): FitBucket {
  if (score == null) return "unscored";
  if (score >= 80) return "80+";
  if (score >= 60) return "60-79";
  if (score >= 40) return "40-59";
  return "<40";
}
