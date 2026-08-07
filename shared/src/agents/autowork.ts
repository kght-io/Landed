// Auto-work: when a job is queued, the matching agent starts draining it right away — no manual
// "Work queue" click. Work is never BLOCKED on the user: a big backlog starts too. What a big
// backlog buys you is a *notice* — the agent says "I'm working these 12 jobs", lists them so you can
// cancel the ones you don't need, and offers a brake ("Stop work"). Acting on that notice (or
// ignoring it) is remembered per agent, so it never nags about the same agent twice.
//
// This module is the PURE decision: given the per-type queued counts, which agents are already
// draining, and which the user has already dealt with, decide what to start and what to speak up
// about. The React bridge (AutoWorkController) owns the effects; keeping the rule here makes it
// testable.

export const AUTO_WORK_THRESHOLD = 5; // drain up to this many silently; above it, say so

export type AutoWorkInput = {
  enabled: boolean; // the "Auto-work queue" toggle (off → never auto-start)
  byType: Record<string, number>; // queued (NOT wip) job count per type
  running: (type: string) => boolean; // an agent is already draining this type
  held: (type: string) => boolean; // this agent's auto-drain is paused (manual Stop / "Stop work")
  // Did this type's queue just GROW (a new item was added since the last check)? The big-batch notice
  // only fires on growth — so a queue that was already long when the app loaded is worked without a
  // popup on every reload. Defaults to always-grew.
  grew?: (type: string) => boolean;
  // Has the user already dealt with this agent's backlog notice (ignored it, cancelled jobs from it,
  // or stopped it)? Remembered across reloads — such an agent works its queue without ever speaking
  // up again. It does NOT override the off switch, a live run, or a held agent.
  ignored?: (type: string) => boolean;
  threshold?: number;
};

export type AutoWorkPlan = {
  start: string[]; // types to auto-drain now (sorted, stable)
  notify: string[]; // types with a big backlog — surface the popup (independent of `start`: an agent
                    // already draining one isn't re-started, but still has something to say)
};

// Decide per type: start it, speak up about it, or leave it alone. A running type isn't re-started
// (don't double-spawn) but can still notify; a held type is skipped entirely (the user pressed the
// brake — wait for a manual start). Deterministic + sorted so the caller/tests are stable.
export function autoWorkPlan(input: AutoWorkInput): AutoWorkPlan {
  const threshold = input.threshold ?? AUTO_WORK_THRESHOLD;
  const grew = input.grew ?? (() => true);
  const ignored = input.ignored ?? (() => false);
  const start: string[] = [];
  const notify: string[] = [];
  if (!input.enabled) return { start, notify };
  for (const type of Object.keys(input.byType).sort()) {
    const n = input.byType[type];
    if (n <= 0) continue;
    if (input.held(type)) continue;
    if (!input.running(type)) start.push(type);
    // Over threshold: speak up, but only on a fresh add, and only until the user has dealt with this
    // agent once. A long queue sitting since load, or shrinking as it drains, never re-pops.
    if (n > threshold && grew(type) && !ignored(type)) notify.push(type);
  }
  return { start, notify };
}
