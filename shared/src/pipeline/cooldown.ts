// Company cooldown: after a company rejects you at the end of a REAL interview loop, stop showing
// you its jobs for six months. Discovery skips it, the scan queue skips it, and anything that still
// arrives is filed away instead of landing on the board.
//
// The bar is deliberately high, because the cheap signal is wrong. `postings.interviewed` is set by
// any move into the interview stage — a recruiter screen sets it too — so it can't tell "they
// interviewed me and passed" from "a recruiter said no after 20 minutes". Only a logged round that
// isn't a recruiter screen earns a cooldown; everything else is left to the manual button.
//
// This module is the PURE decision — no DB, no clock of its own. `today` is an injectable default
// param (the reapplyInfo convention) and dates are YYYY-MM-DD compared lexicographically.

import type { Posting, Status } from "../types";

export const COOLDOWN_MONTHS = 6;

// The rule reads four fields, so it asks for four — not a whole Posting. That lets the DB side feed
// it a lean row (see backend/src/db/cooldown.ts) instead of fabricating a company name and tier just
// to satisfy the type.
export type CooldownPosting = Pick<Posting, "id" | "status" | "updatedAt" | "appliedDate" | "interviews">;

// Add months to a YYYY-MM-DD date. All-UTC arithmetic on purpose: building a local Date and reading
// it back with toISOString() shifts the answer a day in any positive-offset timezone.
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  // Day-of-month overflow rolls forward the way Date does (Aug 31 + 6mo → Mar 3), which is fine for
  // a coarse 6-month gate — it just has to be deterministic.
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

// A recruiter screen is not an interview, and no rounds logged at all is not proof of one either.
export function hadRealInterview(p: Pick<Posting, "interviews">): boolean {
  return (p.interviews ?? []).some((r) => !!r.kind && r.kind !== "recruiter_screen");
}

// Still in play with this company — a rejection on one req shouldn't mute a company you're mid-loop
// with on another.
const ACTIVE: ReadonlySet<Status> = new Set<Status>(["applied", "interview", "offer"]);

export type CooldownDecision =
  | { cool: false; reason: "no-qualifying-rejection" | "active-elsewhere" | "expired" }
  | { cool: true; until: string; from: string }; // from = the rejection date that earned it

// Should this company be cooling, given everything you have with them? Checked in order: are you
// still active here → did any rejection actually earn it → has it already run out.
// `activeScope` is where "are you still in play here?" is asked, and defaults to the same list the
// rejection dates come from. It's a separate parameter because a single rejection that just landed
// is judged against the company's WHOLE book, not just itself — see cooldownFromRejection.
export function companyCooldown(
  items: CooldownPosting[],
  today = new Date().toISOString().slice(0, 10),
  activeScope: CooldownPosting[] = items,
): CooldownDecision {
  if (activeScope.some((p) => ACTIVE.has(p.status))) return { cool: false, reason: "active-elsewhere" };
  // The date a rejection is counted from is the rejection date (`updatedAt`, which the drawer lets
  // you set by hand), falling back to when you applied.
  const dates = items
    .filter((p) => p.status === "rejected" && hadRealInterview(p))
    .map((p) => p.updatedAt || p.appliedDate)
    .filter((d): d is string => !!d)
    .sort();
  const from = dates[dates.length - 1]; // the most recent rejection sets the clock
  if (!from) return { cool: false, reason: "no-qualifying-rejection" };
  const until = addMonths(from, COOLDOWN_MONTHS);
  if (today >= until) return { cool: false, reason: "expired" };
  return { cool: true, until, from };
}

// The cooldown earned by ONE rejection that just landed, rather than by the company's whole
// history. This is what the write path uses, and the distinction matters: recomputing over every
// posting would resurrect a cooldown you deliberately cleared the next time anything at that
// company changed. Only a fresh qualifying rejection may re-cool a company.
// `all` is still every posting there, because "are you active elsewhere" is a company-wide question.
export function cooldownFromRejection(
  trigger: CooldownPosting,
  all: CooldownPosting[],
  today = new Date().toISOString().slice(0, 10),
): CooldownDecision {
  return companyCooldown([trigger], today, all);
}

// Is a stored cooldown date still in force? The `until` day itself is free.
export function isCooling(
  until: string | null | undefined,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  return !!until && today < until;
}

// A second rejection while already cooling EXTENDS the cooldown; it never shortens it. Same rule
// for a manual date sitting alongside a computed one — the later wins, so a hand-set date survives
// a recompute. Clearing is a separate, explicit write of null.
export function extendCooldown(current: string | null | undefined, next: string | null): string | null {
  if (!current) return next;
  if (!next) return current;
  return next > current ? next : current;
}

// Which discovery rows disappear while a company is cooling — the untriaged pile, the stuff that
// would otherwise be asking for your attention. Hiding is read-time and non-destructive: the rows
// come straight back when the cooldown lapses or you clear it.
//
// Tailoring work is deliberately NOT hidden. A tailored résumé is an artifact on disk that took
// real effort; losing sight of it would be a worse outcome than seeing one stale company.
const HIDDEN_WHILE_COOLING: ReadonlySet<string> = new Set([
  "matched", "review", "fit_queue", "apply_later", "assessed", "filtered", "dismissed",
]);

// The whole hide rule in one predicate, so the read paths can't drift apart on half of it.
export function isHiddenWhileCooling(cooling: ReadonlySet<number>, row: { companyId: number; state: string }): boolean {
  return cooling.has(row.companyId) && HIDDEN_WHILE_COOLING.has(row.state);
}

// Guard for the write path: only a real YYYY-MM-DD gets stored, so a stray "6 months" can't land in
// the column and silently read as "not cooling" forever.
export function isValidCooldownDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v; // rejects 2026-13-01, 2026-02-30
}
