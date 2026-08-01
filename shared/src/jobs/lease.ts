// ── the claim lease rule ──
// A claim is a *lease*, not a permanent lock. An agent flips a job to `wip` before working it; if
// that agent crashes, abandons the run, or stalls, the claim would otherwise pin the job in `wip`
// forever. After the lease expires the job is treated as abandoned: claimable again, and surfaced as
// pending in listings, so the next run reclaims it with no manual step. A `wip` row with a null
// claimedAt (legacy/torn write) counts as stale too, so it can never get stuck.
//
// This lives in `shared` because two layers have to grade a lease identically: the queue itself
// (backend/src/jobs/queue.ts) and the ops view (backend/src/db/ops.ts). Two copies of the rule would
// let the ops page report work as in flight after the queue had already given up on it — and having
// `db` import it from `jobs` to avoid that was one of the edges in the db ↔ jobs ↔ agents cycle.
// It is pure arithmetic on a timestamp, so it costs `shared` nothing.

export const CLAIM_LEASE_MS = 60 * 60 * 1000;

// Takes `now` explicitly so callers that already have a clock (a snapshot grading many rows against
// one instant) stay hermetic and testable.
export const isStaleClaimAt = (status: string, claimedAt: string | null | undefined, now: number): boolean =>
  status === "wip" && (!claimedAt || Date.parse(claimedAt) < now - CLAIM_LEASE_MS);
