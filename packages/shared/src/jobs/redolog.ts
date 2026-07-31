import type { DiffOp } from "../linediff";
import type { RedoPhase, RedoTurn } from "../types";

// Helpers for the posting redo conversation (postings.redo_log). One JSON RedoTurn[] holds both
// logical threads (fit + tailor); callers filter by phase. Each agent turn is a version; user
// turns are redo instructions. See lib/types.ts RedoTurn and the "redo with a note" flow.

export function parseRedoLog(raw: string | null | undefined): RedoTurn[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? (a as RedoTurn[]) : [];
  } catch {
    return [];
  }
}

export const phaseTurns = (log: RedoTurn[], phase: RedoPhase): RedoTurn[] =>
  log.filter((t) => t.phase === phase);

// the agent's annotated diff for a tailored version (the agent turn whose slug matches), or the latest
// tailor version's diff when no slug is given. Undefined when that version has no annotated diff
// (legacy versions, or the agent didn't supply one) — the UI then falls back to the computed diff.
export const tailorDiffFor = (log: RedoTurn[], slug?: string): DiffOp[] | undefined => {
  const agents = phaseTurns(log, "tailor").filter((t) => t.role === "agent");
  const turn = slug ? agents.filter((t) => t.slug === slug).pop() : agents.pop();
  return turn?.diff;
};

// When the résumé was last tailored = the `at` of the most recent tailor AGENT turn (each agent turn
// is a produced version). Null when nothing has been tailored yet.
export const lastTailoredAt = (log: RedoTurn[]): string | null => {
  const turn = phaseTurns(log, "tailor").filter((t) => t.role === "agent").pop();
  return turn?.at ?? null;
};

// The version this phase's NEXT agent attempt will produce = prior agent turns + 1 (v1 first).
export const nextVersion = (log: RedoTurn[], phase: RedoPhase): number =>
  phaseTurns(log, phase).filter((t) => t.role === "agent").length + 1;

export const appendTurn = (raw: string | null | undefined, turn: RedoTurn): string =>
  JSON.stringify([...parseRedoLog(raw), turn]);

// Index of a phase's trailing user turn when a redo is pending (its newest turn is a user request
// the agent hasn't answered yet), else -1. Used to EDIT the pending note in place (re-queue) or
// DROP it (the redo job was removed) rather than stacking a second consecutive user turn.
export const pendingUserIndex = (log: RedoTurn[], phase: RedoPhase): number => {
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].phase !== phase) continue;
    return log[i].role === "user" ? i : -1;
  }
  return -1;
};

// A phase has a redo in flight when its newest turn is an unanswered user request. Drives the
// "Queued for redo" tag (server-side; the live UI reads the queue — see AgentQueueProvider).
export const hasPendingRedo = (log: RedoTurn[], phase: RedoPhase): boolean => pendingUserIndex(log, phase) >= 0;

// The pending redo note for a phase (to carry into the job params / pre-fill the composer), or "".
export const pendingRedoNote = (log: RedoTurn[], phase: RedoPhase): string => {
  const i = pendingUserIndex(log, phase);
  return i >= 0 ? log[i].text : "";
};

// Render a phase's conversation as a compact text block for the agent's task — its own prior
// notes interleaved with the user's redo requests, oldest → newest. Empty when there's no history.
export function renderThread(log: RedoTurn[], phase: RedoPhase): string {
  const turns = phaseTurns(log, phase);
  if (!turns.length) return "";
  return turns
    .map((t) => (t.role === "agent" ? `[v${t.version ?? "?"} · you] ${t.text}` : `[redo · You] ${t.text}`))
    .join("\n");
}
