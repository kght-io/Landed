import { Mail, Sparkles, Scissors, Bot, Radar, Building2, GraduationCap, FlaskConical, Code2 } from "lucide-react";

// Per job-type presentation, shared by the Agents page and the floating queue so they never drift.
export const JOB_ICON: Record<string, typeof Mail> = {
  "watchlist-add": Building2, "watchlist-scan": Radar, "inbox-sync": Mail, fit: Sparkles, tailoring: Scissors,
  prep: GraduationCap, "prep-research": FlaskConical, "leetcode-add": Code2,
};
export const jobIcon = (type: string) => JOB_ICON[type] ?? Bot;

// The change log / job queue still STORE the legacy actor value "CoWork" (source "cowork") for
// persistence + filter continuity. Display it as "Agent"/"agent" everywhere so the UI never shows
// the old codename. Keep this the single mapping used by every actor/createdBy/claimedBy render site.
export const actorLabel = (a?: string | null): string => (a === "CoWork" ? "Agent" : a ?? "");
export const sourceLabel = (s?: string | null): string => (s === "cowork" ? "agent" : s ?? "");

// Agents all share the robot (Bot) icon, distinguished by colour per type. Used on the Agents page
// and the floating queue so an agent reads the same everywhere.
export const AGENT_COLOR: Record<string, string> = {
  fit: "text-emerald-300",
  tailoring: "text-violet-300",
  "inbox-sync": "text-amber-300",
  "watchlist-scan": "text-cyan-300",
  "watchlist-add": "text-blue-300",
  leveling: "text-fuchsia-300",
  "prep-research": "text-teal-300",
  prep: "text-lime-300",
  "leetcode-add": "text-orange-300",
  discovery: "text-sky-300",
};
export const agentColor = (type: string) => AGENT_COLOR[type] ?? "text-sky-300";

// Short verb label for a queued job, e.g. the chip on a queue row.
export const JOB_VERB: Record<string, string> = {
  "watchlist-add": "Add company", "watchlist-scan": "Scan watchlist", "inbox-sync": "Sync inbox",
  fit: "Assess fit", tailoring: "Tailor resume", prep: "Coding prep", "prep-research": "Prep research",
  "leetcode-add": "Add leetcode Q",
};
export const jobVerb = (type: string) => JOB_VERB[type] ?? type;

// Playbook file each type follows (mirrors lib/jobs/registry.ts JOB_DEFS.playbook) — client-safe, so
// the type-scoped "copy prompt" can name the exact instructions/<file> for the chosen queue.
export const JOB_PLAYBOOK: Record<string, string> = {
  "watchlist-add": "watchlist-add.md", leveling: "leveling.md", "watchlist-scan": "watchlist-scan.md",
  fit: "fit.md", tailoring: "tailoring.md", "inbox-sync": "inbox-sync.md", prep: "prep.md", "prep-research": "prep-research.md",
  "leetcode-add": "leetcode-add.md",
};
export const jobPlaybook = (type: string) => JOB_PLAYBOOK[type] ?? `${type}.md`;

// Queue-depth signal for a type's count badge: green = comfortable, light orange = getting heavy, dark
// orange = overloaded → trim or clear it before it balloons (heavy types like fit/tailoring are slow
// per job, so a deep queue is a real backlog). Static colour only — blinking is reserved for the
// has-WIP signal (see wipBlink). Shared by the floating queue + the Agents page.
export const QUEUE_WARN = 12; // light orange
export const QUEUE_HEAVY = 30; // dark orange
export function loadTone(n: number): string {
  if (n >= QUEUE_HEAVY) return "bg-orange-600/40 text-orange-200";
  if (n >= QUEUE_WARN) return "bg-amber-500/25 text-amber-200";
  return "bg-emerald-500/20 text-emerald-300";
}
export const loadHint = (n: number): string =>
  n >= QUEUE_HEAVY ? `${n} queued — overloaded, clear or trim this queue`
    : n >= QUEUE_WARN ? `${n} queued — getting heavy`
    : `${n} queued`;

// A type tab blinks while it has a job IN PROGRESS (a live wip claim), so the eye lands on what
// The agent is actively working. `.agent-blink` is defined in globals.css.
export const hasWip = (list: { status: string }[]): boolean => list.some((j) => j.status === "wip");
export const wipBlink = (list: { status: string }[]): string => (hasWip(list) ? "agent-blink" : "");

// Confirmation before force-requeuing an in-progress job — only safe once you KNOW the agent thread
// died (otherwise a live agent's result is rejected when it tries to submit a job you stole back).
// Shared by the floating queue + the Agents page.
export const KILL_CONFIRM =
  "This job is In progress. Only do this if the agent thread that claimed it has DIED — it will be cleared back to Queued for another run. If the thread is still alive its result will be rejected. Continue?";

// The subject a job acts on (company — role), pulled from params.postings[0] or flat params.
// Returns null for board-wide jobs (watchlist-scan, inbox-sync) that have no single subject.
export function jobSubject(job: { params?: Record<string, unknown> }): string | null {
  const p = job.params ?? {};
  const post = Array.isArray(p.postings) ? (p.postings[0] as Record<string, unknown> | undefined) : undefined;
  const company = (post?.company ?? p.company) as string | undefined;
  const role = (post?.role ?? p.role) as string | undefined;
  if (!company) return null;
  return role ? `${company} — ${role}` : company;
}
