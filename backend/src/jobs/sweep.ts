import { reapStuckJobs } from "./queue";
import { reconcileFitQueue } from "./enqueue/fit";
import { reconcileTailoringQueue } from "./enqueue/tailoring";

// ── one tick of the queue's self-healing ──
// Three things have to happen before the queue can be read or claimed honestly:
//   • re-assert a job for any fit_queue / tailoring candidate that lost its projection,
//   • reap abandoned claims (silent agent or expired lease) so the work is claimable again.
//
// This lives here rather than in queue.ts because the reconcilers are per-type (./enqueue/*) and
// queue.ts is deliberately type-agnostic — importing them there would point the spine at its own
// callers.
//
// WHY every consumer must call it, not just the UI poll: `listJobs()` derives status from the
// LEASE alone, so a job whose agent went silent still reads as `wip` for the rest of its 60-minute
// lease. The heartbeat signal that spots the dead agent in ~15 minutes lives in reapStuckJobs, and
// nowhere else. Before this existed the only sweep was piggybacked on `GET /api/jobs` — so an agent
// long-polling /api/jobs/wait could sit idle for 45 more minutes next to work it was free to take,
// unless somebody happened to have the app open in a browser. Cheap and idempotent: call it at the
// top of any path that is about to act on queue state.
export function sweepQueue(): { reaped: number; fitRequeued: number; tailoringRequeued: number } {
  const fitRequeued = reconcileFitQueue();
  const tailoringRequeued = reconcileTailoringQueue();
  const reaped = reapStuckJobs();
  return { reaped, fitRequeued, tailoringRequeued };
}
