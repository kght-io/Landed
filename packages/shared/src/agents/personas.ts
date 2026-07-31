// Shared persona names + the per-type "drain the queue" kickoff prompt. Used by the headless run
// route (/api/agents/run) and the live streaming agents (/api/agents/live) so both speak with the
// same voice and scope each run to ONE job type.

export const PERSONA: Record<string, string> = {
  fit: "Fit Assessor",
  tailoring: "Résumé Tailor",
  "inbox-sync": "Inbox Scout",
  "watchlist-scan": "Board Scanner",
  "watchlist-add": "Watchlist Curator",
  leveling: "Leveler",
  "prep-research": "Prep Researcher",
  prep: "Prep Coach",
  "leetcode-add": "Leetcode Scout",
  discovery: "Scout",
  "fitlab-assess": "Fit Lab",
  "interview-brief": "Interview Briefer",
  "interview-emails": "Interview Scout",
  "peer-comp": "Comp Analyst",
};

// Fall back to a task-descriptive name (the prettified type), never a brand — a new job type gets a
// sensible label on the Agents page without a map edit.
export const personaFor = (type: string): string =>
  PERSONA[type] ?? type.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// One-shot kickoff: claim + work + submit, looping until the type's queue is empty, then stop.
export const drainPrompt = (type: string): string =>
  `You are the ${personaFor(type)} running as a live Claude Code agent. Your only job type is "${type}". ` +
  `Drain the queue now: loop — call claimNext({type:"${type}"}); if it returns a job, do the work per its ` +
  `playbook (call getPlaybook first if unsure) and finish with submitJobResult; repeat until claimNext ` +
  `returns no job. Then STOP. Do NOT call waitForWork — just drain what's queued and exit. ` +
  `Narrate what you're doing in one short line per step so I can follow along.`;
