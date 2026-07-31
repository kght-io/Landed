// Auto-work: when a job is queued, the matching agent starts draining it right away — no manual
// "Work queue" click. The one guardrail is token spend: a big backlog for a type shouldn't silently
// launch a long, expensive drain, so anything over the threshold is gated behind a confirm popup
// (the user sees the list and opts in). Small batches auto-start.
//
// This module is the PURE decision: given the per-type queued counts, which agents are already
// draining, and which types the user has dismissed, decide what to start now vs. what to confirm.
// The React bridge (AutoWorkController) owns the effects; keeping the rule here makes it testable.

export const AUTO_WORK_THRESHOLD = 5; // auto-start ≤ this many queued; above it, ask first

export type AutoWorkInput = {
  enabled: boolean; // the "Auto-work queue" toggle (off → never auto-start)
  byType: Record<string, number>; // queued (NOT wip) job count per type
  running: (type: string) => boolean; // an agent is already draining this type
  held: (type: string) => boolean; // this agent's auto-drain is paused (manual Stop / "Not now")
  // Did this type's queue just GROW (a new item was added since the last check)? The big-batch
  // confirm only fires on growth — so a queue that was already long when the app loaded never pops a
  // confirm on mount; it waits for a fresh add (or a manual "Work queue"). Defaults to always-grew.
  grew?: (type: string) => boolean;
  threshold?: number;
};

export type AutoWorkPlan = {
  start: string[]; // types to auto-drain now (sorted, stable)
  confirm: string[]; // types with a big backlog — surface a confirm popup
};

// Decide per type: start now, confirm first, or leave alone. A type is skipped entirely when an
// agent is already draining it (don't double-spawn) or the user held it (they said "not now" — wait
// for the queue to clear or a manual start). Deterministic + sorted so the caller/tests are stable.
export function autoWorkPlan(input: AutoWorkInput): AutoWorkPlan {
  const threshold = input.threshold ?? AUTO_WORK_THRESHOLD;
  const grew = input.grew ?? (() => true);
  const start: string[] = [];
  const confirm: string[] = [];
  if (!input.enabled) return { start, confirm };
  for (const type of Object.keys(input.byType).sort()) {
    const n = input.byType[type];
    if (n <= 0) continue;
    if (input.running(type) || input.held(type)) continue;
    if (n <= threshold) start.push(type);
    // Over threshold: confirm only if the queue just grew (a new add). A long queue sitting since
    // load, or shrinking as it drains, never re-pops the confirm.
    else if (grew(type)) confirm.push(type);
  }
  return { start, confirm };
}
