// Single source of truth for the DB's enumerated value sets. Consumed by BOTH the Drizzle
// schema (column `enum` options, in schema.ts) and the validation triggers (index.ts), so the
// ORM types and the DB-level enforcement are generated from the same arrays and can't drift.
//
// SQLite can't ALTER a table to ADD a CHECK constraint, so enforcement is done with BEFORE
// INSERT/UPDATE triggers rebuilt from these arrays on every boot (see enumGuard in index.ts).
// Adding a value here updates the type, the trigger, and the allowed set in one edit.

export const POSTING_STATES = [
  "filtered", "matched", "review", "dismissed", "fit_queue", "assessed", "apply_later",
  "tailoring", "tailored", "applied", "interview", "offer", "accepted", "rejected",
  "ghost", "withdrawn", "company_skipped", "expired",
] as const;

export const POSTING_VERDICTS = ["kept", "dropped"] as const;
export const POSTING_CHANNELS = ["direct", "referral"] as const;
export const COMPANY_TIERS = ["tier1", "tier2", "tier3"] as const;
export const JOB_STATUSES = ["queued", "wip", "ingested", "failed"] as const;
// `match` = pick which posting an incoming record belongs to; `unbound` = a fit/tailor result whose
// echoed id didn't resolve (alert, dismiss-only); `change` = a change an inbox sync WANTS to make,
// held until you approve it (a plain TEXT column, so no migration — see backend/src/db/index.ts).
export const PENDING_KINDS = ["match", "unbound", "change"] as const;
export const PENDING_STATUSES = ["pending", "resolved", "dismissed"] as const;
