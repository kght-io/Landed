// The ONE place that decides "which existing posting does this incoming record refer to?".
// Every ingest path (inbox reconcile today; others share the helpers) routes through here so the
// matching keys + normalization stay consistent. See docs / the unified-postings model: a candidate
// and its applied row are the SAME `postings` row, so a confident match graduates it in place.

import type { PostingRow } from "@landed/backend/db/schema";
import { norm } from "./canonical";
import type { IncomingApp } from "./types";

export { norm };

// Post-apply lifecycle outcomes — a status that can only be a PROGRESSION of an existing
// application (you don't get rejected from / interviewed for a role you never applied to). A fresh
// "applied" is deliberately excluded: it might be a second, different role at the same company.
const OUTCOME_STATUS = new Set(["interview", "offer", "rejected", "ghost", "expired", "accepted", "withdrawn"]);

export type MatchResult =
  | { kind: "unique"; app: PostingRow } // confident single match → auto-apply
  | { kind: "fuzzy"; candidates: PostingRow[] } // non-exact (e.g. email missing the team) → ALWAYS ask
  | { kind: "ambiguous"; candidates: PostingRow[] } // exact but 2+ → ask
  | { kind: "none" }; // genuinely new → insert

// Title → token set: lowercase, split on non-alphanumeric, drop empties. Used for the fuzzy tier
// (norm() collapses to one string and can't compare token containment).
export function tokens(s: string | null | undefined): string[] {
  return String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// Exact, high-confidence match over a pool: URL equality, then exact normalized title, with an
// appliedDate tiebreak for same-title rows and a lone-candidate fallback for role-less records.
// Returns the same unique/ambiguous/none shape so callers that only want exact matching can share it.
export function exactMatch(pool: PostingRow[], rec: IncomingApp): MatchResult {
  if (pool.length === 0) return { kind: "none" };

  // 1. Stable key — exact URL match (records that carry the link).
  if (rec.url) {
    const byUrl = pool.filter((a) => a.url && a.url === rec.url);
    if (byUrl.length === 1) return { kind: "unique", app: byUrl[0] };
    if (byUrl.length > 1) return { kind: "ambiguous", candidates: byUrl };
  }

  // 2. Exact normalized role/title — the common high-confidence signal.
  const r = norm(rec.role ?? "");
  if (r) {
    const byRole = pool.filter((a) => norm(a.title ?? "") === r);
    if (byRole.length === 1) return { kind: "unique", app: byRole[0] };
    if (byRole.length > 1) {
      if (rec.appliedDate) {
        const byRoleDate = byRole.filter((a) => a.appliedDate === rec.appliedDate);
        if (byRoleDate.length === 1) return { kind: "unique", app: byRoleDate[0] };
      }
      return { kind: "ambiguous", candidates: byRole };
    }
    // Role given but matches nothing exactly → fall through to the caller's fuzzy / outcome tier.
    return { kind: "none" };
  }

  // 3. No role on the incoming record (e.g. a bare "rejected at X" email).
  if (rec.appliedDate) {
    const byDate = pool.filter((a) => a.appliedDate === rec.appliedDate);
    if (byDate.length === 1) return { kind: "unique", app: byDate[0] };
    if (byDate.length > 1) return { kind: "ambiguous", candidates: byDate };
  }
  if (pool.length === 1) return { kind: "unique", app: pool[0] };
  return { kind: "ambiguous", candidates: pool };
}

// One token set is a subset of the other, they share the leading token, and the smaller set has
// ≥2 tokens. So "senior software engineer" ⊆ "senior software engineer ads" matches (email dropped
// the team); "senior software engineer" vs "senior data scientist" (only "senior" shared) does not.
function fuzzyTitleMatch(recRole: string, title: string): boolean {
  const a = tokens(recRole);
  const b = tokens(title);
  if (a.length === 0 || b.length === 0 || a[0] !== b[0]) return false;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  if (small.length < 2) return false;
  const bigSet = new Set(big);
  return small.every((t) => bigSet.has(t));
}

// An incoming record that can only be about an interview you're already in: an `interview` status,
// interview rounds, or the interviewed flag.
const isInterviewRec = (rec: IncomingApp): boolean =>
  rec.status === "interview" || !!rec.interviews?.length || rec.interviewed === true;

// Narrow the pool for an interview email: once a company has a posting sitting in the `interview`
// stage, THAT (or one of those) is what a scheduling / round / feedback email is about. Searching
// every prior-stage row too was strictly wrong — it turned an unambiguous email into a fuzzy "which
// of your 5 Reddit postings?" approval, and could re-point the email at a candidate you hadn't even
// applied to. Returns the narrowed pool, or null when the rule doesn't apply (not interview-related,
// or the company has nothing at the interview stage) and the caller should use the full pool.
export function interviewNarrowed(pool: PostingRow[], rec: IncomingApp): PostingRow[] | null {
  if (!isInterviewRec(rec)) return null;
  const inInterview = pool.filter((p) => p.state === "interview");
  return inInterview.length ? inInterview : null;
}

// The full decision: exact first; if a role was given but matched nothing exactly, try a FUZZY title
// match over the `fuzzyStates` subset of the pool (a non-exact hit is never auto-applied — it returns
// `fuzzy` so the caller raises a human approval). `fuzzyStates` lets the caller restrict fuzzy/ask
// candidates to, e.g., pre-apply stages only (never re-point an email at an applied/closed row).
export function matchPosting(
  pool: PostingRow[],
  rec: IncomingApp,
  opts: { fuzzyStates: Set<string> },
): MatchResult {
  const exact = exactMatch(pool, rec);
  if (exact.kind === "unique") return exact; // confident → auto-apply

  // A post-apply OUTCOME (rejected / interview / offer / …) belongs to an EXISTING application —
  // you don't get rejected from a role you never applied to. So when the company already has any
  // active posting, NEVER insert a new one: ask the user to confirm which posting it belongs to
  // (the whole pool — incl. tracker stages — are candidates; a single candidate is a 1-click
  // confirm). Only a company with NO postings falls through to insert (a historical outcome).
  if (OUTCOME_STATUS.has(rec.status ?? "") && pool.length > 0) {
    if (exact.kind === "ambiguous") return exact; // exact-title collisions → ask over that subset
    return { kind: "fuzzy", candidates: pool }; // none/other → ask over all active candidates
  }

  // Otherwise (e.g. a fresh "applied"): take the exact result, or try a fuzzy title match over the
  // pre-apply stages only (never auto-repoint an applied/closed row); else it's genuinely new.
  if (exact.kind !== "none") return exact;
  const r = norm(rec.role ?? "");
  if (!r) return exact;
  const fuzzy = pool.filter(
    (a) => opts.fuzzyStates.has(a.state) && fuzzyTitleMatch(rec.role ?? "", a.title ?? ""),
  );
  if (fuzzy.length > 0) return { kind: "fuzzy", candidates: fuzzy };
  return { kind: "none" };
}
