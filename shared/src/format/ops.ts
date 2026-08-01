// Grading the health signals the ops view shows. Pure — no DB, no clock, no fs — so the thresholds
// are directly testable and the same words mean the same thing everywhere they're rendered.
//
// The judgement encoded here: DEPTH is not a problem, AGE is. A queue with 30 jobs in it is a
// normal Monday — the agent just hasn't run yet. One job that has sat unclaimed since yesterday
// means nothing is draining the queue, which is the failure worth waking up to.

export type OpsTone = "good" | "warning" | "critical" | "neutral";

// Work waiting longer than this hasn't been picked up by any agent run.
export const QUEUE_SLOW_MS = 4 * 3_600_000; // 4h — a drain should have happened by now
export const QUEUE_STUCK_MS = 24 * 3_600_000; // 24h — nothing is draining the queue at all

// Inbox sync is scheduled daily (see inbox-schedule.ts), so one missed slot is ~26h of silence.
export const SYNC_DUE_MS = 26 * 3_600_000; // missed today's run
export const SYNC_LATE_MS = 48 * 3_600_000; // missed two days — the connection is probably broken

const RANK: Record<OpsTone, number> = { neutral: 0, good: 1, warning: 2, critical: 3 };

// The headline takes the worst of its parts: one broken thing makes the system not-healthy, however
// green everything else is. `neutral` means "nothing to report", so an empty list stays neutral.
export function worstTone(tones: OpsTone[]): OpsTone {
  return tones.reduce<OpsTone>((worst, t) => (RANK[t] > RANK[worst] ? t : worst), "neutral");
}

export function queueTone(o: { queued: number; failed: number; oldestQueuedAgeMs: number | null }): OpsTone {
  const age = o.oldestQueuedAgeMs;
  if (age !== null && age > QUEUE_STUCK_MS) return "critical";
  if (age !== null && age > QUEUE_SLOW_MS) return "warning";
  if (o.failed > 0) return "warning"; // a dead job never fixes itself — it needs a look
  return "good";
}

// `null` = never synced. That's not "fine, nothing to show" — it means the feature has never worked.
export function syncTone(ageMs: number | null): OpsTone {
  if (ageMs === null) return "critical";
  if (ageMs > SYNC_LATE_MS) return "critical";
  if (ageMs > SYNC_DUE_MS) return "warning";
  return "good";
}
