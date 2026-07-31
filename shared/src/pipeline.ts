import { STATUS_ORDER, type Posting, type Status, type Tier } from "./types";

// The tracker stages — postings graduated past discovery. One unified `candidates` table now: the
// funnel owns the pre-apply stages, the board/tracker read these. (Home here — a leaf module — so
// queries/store/scan/reconcile can all import it without a cycle.) See docs/unify-postings-plan.md.
export const TRACKER_STAGES = ["applied", "interview", "offer", "accepted", "rejected", "ghost", "withdrawn", "company_skipped", "expired"] as const;

// Display columns for the board. Several terminal statuses collapse into "Closed".
export type ColumnId =
  | "discovered"
  | "assessed"
  | "tailoring"
  | "applied"
  | "interviewing"
  | "closed";

export const COLUMNS: { id: ColumnId; label: string; hint: string }[] = [
  { id: "applied", label: "Applied", hint: "Submitted" },
  { id: "interviewing", label: "Interviewing", hint: "In the loop" },
  { id: "closed", label: "Closed", hint: "Outcome reached" },
];

const STATUS_TO_COLUMN: Record<Status, ColumnId> = {
  discovered: "discovered",
  assessed: "assessed",
  tailoring: "tailoring",
  applied: "applied",
  interview: "interviewing",
  offer: "interviewing",
  accepted: "closed",
  rejected: "closed",
  ghost: "closed",
  withdrawn: "closed",
  company_skipped: "closed",
  expired: "closed",
};

export function columnOf(p: Posting): ColumnId {
  // Fall back to "closed" for any unknown/legacy status (e.g. a pre-rename "skipped"
  // row not yet migrated) so the board never crashes on unexpected data.
  return STATUS_TO_COLUMN[p.status] ?? "closed";
}

// Statuses that collapse into a given column (inverse of STATUS_TO_COLUMN), in
// STATUS_ORDER. Used to offer a per-status sub-filter on columns like "Closed".
export function statusesForColumn(col: ColumnId): Status[] {
  return STATUS_ORDER.filter((s) => STATUS_TO_COLUMN[s] === col);
}

export const TIER_META: Record<
  Tier,
  { label: string; dot: string; ring: string; text: string; bar: string; soft: string }
> = {
  tier1: {
    label: "Tier 1 (top target)", dot: "bg-amber-400", ring: "ring-amber-400/30",
    text: "text-amber-300", bar: "bg-amber-400", soft: "bg-amber-500/10",
  },
  tier2: {
    label: "Tier 2", dot: "bg-emerald-400", ring: "ring-emerald-400/30",
    text: "text-emerald-300", bar: "bg-emerald-400", soft: "bg-emerald-500/10",
  },
  tier3: {
    label: "Tier 3", dot: "bg-zinc-500", ring: "ring-zinc-400/20",
    text: "text-zinc-400", bar: "bg-zinc-600", soft: "bg-zinc-500/10",
  },
};

// Tier order (best → broadest), for filters/columns/selectors.
export const TIERS: Tier[] = ["tier1", "tier2", "tier3"];

// Display date for a tracked job — prefer the application date, else last-updated/discovered.
export function trackerDate(p: { appliedDate?: string; updatedAt?: string; discoveredAt?: string }): string | undefined {
  return p.appliedDate ?? p.updatedAt ?? p.discoveredAt;
}

// Pipeline rollup for a company (discovered/applied/total + per-role items), keyed by company name.
// Drives the watchlist's "Pipeline" column — where each watched company's postings currently sit.
export type TargetCounts = {
  discovered: number;
  applied: number;
  total: number;
  items: { role: string; status: string; date?: string; appliedDate?: string; interviewed?: boolean }[];
};

export function buildTargetCounts(postings: Posting[]): Map<string, TargetCounts> {
  const m = new Map<string, TargetCounts>();
  for (const p of postings) {
    let c = m.get(p.company);
    if (!c) { c = { discovered: 0, applied: 0, total: 0, items: [] }; m.set(p.company, c); }
    c.total++;
    if (p.status === "discovered") c.discovered++;
    if (p.status === "applied") c.applied++;
    c.items.push({ role: p.role, status: p.status, date: trackerDate(p), appliedDate: p.appliedDate, interviewed: p.interviewed });
  }
  return m;
}

// Color for a fit score badge.
export function fitColor(score: number): string {
  if (score >= 80) return "text-emerald-300 border-emerald-400/40 bg-emerald-500/10";
  if (score >= 65) return "text-amber-300 border-amber-400/40 bg-amber-500/10";
  return "text-zinc-400 border-zinc-600/50 bg-zinc-700/20";
}

export const STATUS_LABEL: Record<Status, string> = {
  discovered: "Fit queue",
  assessed: "Fit assessment",
  tailoring: "Tailoring",
  applied: "Applied",
  interview: "Interviewing",
  offer: "Offer",
  accepted: "Accepted",
  rejected: "Rejected",
  ghost: "No response",
  withdrawn: "Withdrawn",
  company_skipped: "Skipped",
  expired: "Expired",
};

// Tailwind classes per status for the rollup breakdown chips.
export const STATUS_CHIP: Record<Status, string> = {
  discovered: "text-zinc-300 bg-zinc-700/40",
  assessed: "text-violet-300 bg-violet-500/15",
  tailoring: "text-amber-300 bg-amber-500/15",
  applied: "text-yellow-200 bg-yellow-500/10",
  interview: "text-emerald-300 bg-emerald-500/15",
  offer: "text-emerald-200 bg-emerald-500/20",
  accepted: "text-emerald-100 bg-emerald-500/25",
  rejected: "text-red-400 bg-red-500/15",
  ghost: "text-zinc-400 bg-zinc-700/40",
  withdrawn: "text-zinc-400 bg-zinc-800/60",
  company_skipped: "text-zinc-500 bg-zinc-800/60",
  expired: "text-orange-300/80 bg-orange-500/10",
};

// Order statuses appear in the breakdown.
export const CHIP_ORDER: Status[] = [
  "discovered", "assessed", "tailoring",
  "applied", "interview", "offer", "accepted", "rejected", "ghost", "withdrawn", "company_skipped", "expired",
];

// Reapply policy. A rejection AFTER an interview is off the table for a cooldown
// period; an auto/email rejection (interviewed=false) or a no-response is eligible.
export const REAPPLY_COOLDOWN_MONTHS = 6;

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export type ReapplyInfo =
  | { state: "n/a" } // not a closed posting
  | { state: "eligible" }
  | { state: "cooldown"; until: string };

export function reapplyInfo(
  p: Posting,
  today = new Date().toISOString().slice(0, 10)
): ReapplyInfo {
  if (
    p.status !== "rejected" && p.status !== "ghost" &&
    p.status !== "company_skipped" && p.status !== "expired"
  )
    return { state: "n/a" };
  // An expired req is closed through no fault of yours → reapply freely when it reopens.
  if (p.status === "expired") return { state: "eligible" };
  // Post-interview rejection → cooldown counted from the rejection date.
  if (p.status === "rejected" && p.interviewed) {
    const base = p.updatedAt || p.appliedDate;
    if (!base) return { state: "cooldown", until: "?" };
    const until = addMonths(base, REAPPLY_COOLDOWN_MONTHS);
    return today >= until ? { state: "eligible" } : { state: "cooldown", until };
  }
  return { state: "eligible" };
}
