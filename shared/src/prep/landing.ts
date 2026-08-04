// Pure selection logic for the prep landing's "Company-specific Prep" tab: which companies are
// actively interviewing vs. past (concluded) interviews, and what the next step in a live loop is.
// Kept db-free so it's directly unit-testable (see tests/prep-landing.test.ts).

import type { InterviewRound, Status } from "../types";

// The round-kind labels live with the loop model; re-exported here because this module's callers
// (the prep landing's "next step" line) have always imported them from it.
export { ROUND_KIND_LABEL } from "../pipeline/interview-loop";
import { ROUND_KIND_LABEL } from "../pipeline/interview-loop";

// Terminal (closed-column) statuses — the loop is over, an outcome was reached.
const CLOSED_STATUSES: ReadonlySet<Status> = new Set<Status>([
  "accepted",
  "rejected",
  "ghost",
  "withdrawn",
  "company_skipped",
  "expired",
]);

// In a live loop → belongs under "Interviewing now".
export function isActivelyInterviewing(p: { status: Status }): boolean {
  return p.status === "interview" || p.status === "offer";
}

// A concluded interview: you actually interviewed (interviewed=true) AND the posting reached a
// terminal outcome → belongs under "Past interviewed companies". Excludes researched-but-never-
// interviewed companies (interviewed falsey) and anything still live.
export function isPastInterviewed(p: { status: Status; interviewed?: boolean }): boolean {
  return p.interviewed === true && CLOSED_STATUSES.has(p.status);
}

// The next scheduled/upcoming round: the earliest round still "pending" (scheduled, not yet done),
// ordered by round number then date. Returns null when nothing is upcoming (or no rounds are known).
export function nextUpcomingRound(rounds: InterviewRound[] | undefined): InterviewRound | null {
  const pending = (rounds ?? []).filter((r) => r.outcome === "pending");
  if (!pending.length) return null;
  return [...pending].sort((a, b) => {
    const ra = a.round ?? Number.POSITIVE_INFINITY;
    const rb = b.round ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return (a.date ?? "").localeCompare(b.date ?? "");
  })[0];
}

// The "next step" label for a live loop: the upcoming round's kind (+ date, formatted by the caller
// if present). Null when no upcoming round is known — the card then falls back to the status alone.
export function nextRoundKindLabel(round: InterviewRound | null): string | null {
  if (!round) return null;
  return round.kind ? ROUND_KIND_LABEL[round.kind] : "Interview";
}
