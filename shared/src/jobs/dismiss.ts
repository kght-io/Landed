// Why a scan result was discarded — the supervised signal the scan filter has never had.
//
// The pre-filter drops on things a title can prove (non-eng, out of area, already tracked). What it
// CAN'T see is why a perfectly good senior SWE posting still gets thrown away: wrong kind of
// engineering, wrong problem space, wrong rung, wrong company. Those judgments only exist in your
// head, and until now they left no trace — 4 of 447 dismissals carried a note. This closes that gap.
//
// Three axes, and each was drawn from how the labels were ACTUALLY used, not from taste:
//
//   `role`   — a different job. SRE, ML/Research, IT, GRC. Not the work you do.
//   `stack`  — the same job, wrong technology. iOS, frontend, C++. Still software engineering.
//   `domain` — the same job and stack, uninteresting problem. Ads, payments, growth.
//
// `stack` was folded into `role` at first, on the argument that iOS reads as a discipline. Use
// disproved it: the first 28 `role` labels split cleanly into ~24 that were a different FUNCTION
// (SRE ×7, Research ×5, ML ×3, IT ×2) and ~4 that were the right function on the wrong technology
// (iOS ×2, frontend infra) — with C++ filed under `domain` because it fit nowhere. A posting can be
// squarely your job and still the wrong stack; that has to be sayable.
//
// ONE reason per dismissal, not a set. Rejection reasons are disjunctive: one sufficient cause is
// all a filter can act on, so tagging a discarded Android role `role` AND `domain` teaches nothing
// the first label didn't. The chips therefore commit on a single click (see ScanResults.tsx).
//
// There is deliberately NO `better-option` label for "good role, I just picked another one at this
// company" — roughly a quarter of the dismissals were that. Recording them as negatives would train
// the filter to suppress exactly the postings it should surface. The fix is structural, not a
// label: once results group by company and collapse, you skip those rows instead of discarding
// them, so they never enter the dataset at all.
export const DISMISS_REASONS = ["role", "stack", "domain", "level", "company", "other"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

// Menu labels. Spelled out rather than bare nouns ("role") because the menu is where the choice is
// actually made: `level` alone reads as "what level is it", not "the level is wrong".
export const DISMISS_REASON_LABELS: Record<DismissReason, string> = {
  role: "Role mismatch",
  stack: "Stack mismatch",
  domain: "Domain mismatch",
  level: "Level mismatch",
  company: "Not this company",
  other: "Other",
};

// What each label means, and the evidence for it in the dismissals that motivated the set.
// Used as the tooltips so the taxonomy is legible at the moment you're applying it — a label
// applied under a different definition each week is worse than no label.
export const DISMISS_REASON_HINTS: Record<DismissReason, string> = {
  role: "A different job — SRE, ML/Research, IT, security, data eng, GRC",
  stack: "Software engineering, but the wrong technology — iOS/Android, frontend, C++, graphics",
  domain: "Uninteresting problem space — ads, payments, growth, marketing, trust & safety",
  level: "Out of my seniority band — too junior, or above the rung I'd take",
  company: "Not this company, whatever the role",
  other: "None of the above",
};

// The guard every writer goes through. Agent/JSON/HTTP input arrives as `unknown`, and a value that
// isn't in the set must not reach the column: the scorer groups by this field, so one stray string
// becomes a bucket that silently splits the dataset.
export function isDismissReason(v: unknown): v is DismissReason {
  return typeof v === "string" && (DISMISS_REASONS as readonly string[]).includes(v);
}
