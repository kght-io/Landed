"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Bold, Bot, Check, ChevronDown, ChevronRight, Coins, ExternalLink, GitCompareArrows, Info, List, Loader2, Mail, MessageSquare, MoreHorizontal, Pencil, Pin, RefreshCw, Trash2, UserCheck, X } from "lucide-react";
import PopoverPanel, { anchorFrom } from "@/components/Popover";
import { columnOf, fitColor, statusesForColumn, STATUS_CHIP, STATUS_LABEL, trackerDate, type ColumnId } from "@landed/shared/pipeline/stages";
import TrackerTag from "@/components/TrackerTag";
import { LevelChip } from "@/components/LevelLadder";
import { DEFAULT_LEVELING_REF, hasLadder, type Leveling, type LevelingRef } from "@landed/shared/config/leveling";
import { useApplications } from "@/hooks/useApplications";
import { useAgentQueue } from "@/components/AgentQueueProvider";
import { JOB_ADDED_EVENT } from "@/components/AddFitModal";
import EmptyStateGetStarted from "@/components/EmptyStateGetStarted";
import CompanyDrawer from "@/components/board/CompanyDrawer";
import ResumeDiffModal from "@/components/ResumeDiff";
import PeerCompModal from "@/components/PeerCompModal";
import { tailorDiffFor, lastTailoredAt } from "@landed/shared/jobs/redolog";
import { aggregateCompanies, type CompanyAgg } from "@landed/shared/pipeline/board";
import {
  applyClosedFilter, closedFilterCounts, resolveClosedFilter, NO_CLOSED_FILTER,
  type ClosedFilter as ClosedFilterState,
} from "@landed/shared/pipeline/closed-filter";
import { ResTh } from "@/components/ResizableTable";
import { DISCOVERY_SPINE as SPINE, DISCOVERY_ARCHIVE as ARCHIVE, ALL_STEPS, DEFAULT_STEP, resolveStep, stepStatesFor as stepStates, stepCount, type SpineStep } from "@landed/shared/pipeline/discovery";
import type { Comment, Posting, FitAssessment, RedoTurn, Status } from "@landed/shared/types";
import { JobStatusChip, type WorkStatus } from "@/components/JobStatus";
import { ago, fmtTs } from "@landed/shared/format/time";
import { usePersistentState } from "@/hooks/usePersistentState";
import { shouldAutoSyncInbox, inboxSyncPending, INBOX_SYNC_PENDING_GRACE_MS, dailySyncJobId, INBOX_DAILY_SYNC_KEY, INBOX_SYNC_TIME_KEY, DEFAULT_INBOX_SYNC_TIME } from "@landed/shared/config/inbox-schedule";

const FUNNEL_LABEL: Record<string, string> = { sel: "", company: "Company", title: "Title", location: "Location", fit: "Fit", lvl: "Lvl", comment: "Note", gaps: "Gaps", resume: "Resume", status: "Status", applied: "Applied", updated: "Last updated", act: "Action" };
// The table is `table-layout: fixed` (frozen columns need their declared widths to be authoritative,
// or the sticky-left offsets — fixed FROZEN_W sums — drift past the real column edges and the frozen
// cells overlap). So every column needs ONE definite width. Frozen columns use FROZEN_W; the rest get
// a fixed width here. Content that exceeds it wraps/truncates instead of expanding the column.
const NONFROZEN_W: Record<string, number> = {
  location: 150, lvl: 60, comment: 72, fit: 420, gaps: 260, resume: 140, status: 120, applied: 110, updated: 120,
};
const colW = (k: string): number => FROZEN_W[k] ?? RIGHT_W[k] ?? NONFROZEN_W[k] ?? 120;
const colStyle = (k: string): React.CSSProperties => ({ width: colW(k), minWidth: colW(k), maxWidth: colW(k) });
// Per-column td className (alignment / tone).
const COL_CLASS: Record<string, string> = {
  company: "text-zinc-400", lvl: "text-center", location: "text-zinc-400",
  resume: "text-[13px] text-zinc-500", applied: "tabular-nums text-zinc-500", updated: "tabular-nums text-zinc-500",
};

// The whole pipeline IS the discovery spine (defined in shared/src/pipeline/discovery.ts), drawn as a connected
// arrow ribbon, left → right. The leading steps span candidate scan-store states (Fit Assessment =
// matched + review + fit_queue + assessed; Tailor Resume = tailoring + tailored; Apply Later = apply_later); the last
// three are TRACKER steps that read `postings` (the applications table) filtered by shared/src/pipeline/stages columnOf, and
// a row click opens the company drawer to manage it.
type ActionKey = "queue-fit" | "discard" | "tailor" | "apply";
// Tracker steps map a spine key → the pipeline column its postings live in (shared/src/pipeline/stages columnOf).
const STEP_COLUMN: Record<string, ColumnId> = { applied: "applied", interview: "interviewing", closed: "closed" };
const isTrackerStep = (key: string) => key in STEP_COLUMN;
// Every pipeline step shows the SAME columns, so a row reads consistently across stages (you always
// see fit + résumé, status, etc., wherever you are). Cells render "—" where a column doesn't apply
// to a given row. Order: the four frozen leading columns, then fit/gaps/résumé (the artifacts you
// most want everywhere), then tracker fields, then the per-row action.
const UNIFIED_COLS = ["sel", "company", "title", "location", "lvl", "comment", "fit", "gaps", "resume", "status", "applied", "updated", "act"];

// PINNED columns (sticky) — one mechanism, two edges. The identity leads freeze LEFT (a tiny checkbox
// column, then Company + Title — a narrow ~440px block), while the per-row Action column pins RIGHT so
// quick actions stay reachable no matter how far the middle scrolls. They differ only in the edge they
// anchor to (and the divider side); `pinnedStyle` / `pinnedCls` branch on that.
const FROZEN_COLS = ["sel", "company", "title"] as const; // left-pinned, in order (offsets accrue)
const FROZEN_W: Record<string, number> = { sel: 40, company: 190, title: 210 };
const RIGHT_W: Record<string, number> = { act: 96 }; // right-pinned (one column → right: 0, no accumulation)
const LAST_FROZEN = FROZEN_COLS[FROZEN_COLS.length - 1];
const isFrozen = (k: string) => k in FROZEN_W;
const isRight = (k: string) => k in RIGHT_W;
const isPinned = (k: string) => isFrozen(k) || isRight(k);
// Left offset = the widths of the frozen columns before `k`.
const frozenLeft = (k: string): number => {
  let x = 0;
  for (const f of FROZEN_COLS) { if (f === k) return x; x += FROZEN_W[f]; }
  return 0;
};
// Sticky style for a pinned cell — left-anchored (offset accrues) or right-anchored (flush). zIndex
// lets the header win over the body.
const pinnedStyle = (k: string, z: number): React.CSSProperties => {
  const w = colW(k);
  const base = { position: "sticky" as const, width: w, minWidth: w, maxWidth: w, zIndex: z };
  return isFrozen(k) ? { ...base, left: frozenLeft(k) } : { ...base, right: 0 };
};
// Opaque, theme-aware background so scrolled cells slide *under* the pinned column cleanly, plus the
// divider on the block's inner edge (right for the last frozen column, left for the right pin).
const pinnedCls = (k: string, body: boolean): string => {
  const divider = isFrozen(k) ? (k === LAST_FROZEN ? "border-r border-zinc-800/80" : "") : "border-l border-zinc-800/80";
  return `bg-[var(--background)] ${body ? "group-hover:bg-zinc-900" : ""} ${divider}`;
};
// Header cells stick on BOTH axes — top (labels stay put as rows scroll) and, for pinned columns,
// their edge. They sit above the body cells (z 30 pinned / 25 the rest) with an opaque bg.
const headerStyle = (k: string): React.CSSProperties =>
  isPinned(k) ? { ...pinnedStyle(k, 30), top: 0 } : { position: "sticky", top: 0, zIndex: 25 };
// Row actions per candidate state, PRIMARY FIRST — the first is the quick button, the rest fold
// into a ⋯ menu. A queued row (fit_queue / tailoring) only offers Discard until the agent writes back.
const ACTIONS_BY_STATE: Record<string, ActionKey[]> = {
  matched: ["queue-fit", "discard"], // freshly scraped, awaiting glance — same triage as `review`
  review: ["queue-fit", "discard"],
  fit_queue: ["discard"],
  assessed: ["tailor", "apply", "discard"],
  apply_later: ["apply", "tailor", "discard"], // held for later → the quick action is to mark it applied
  tailoring: ["apply", "discard"],
  tailored: ["apply", "discard"],
  dismissed: ["queue-fit"],
  filtered: ["queue-fit", "discard"],
};

// The agent hand-off ("queue") actions — grouped into their own menu section (see ActionCell) so
// you can kick off fit assessment or resume tailoring from any pre-apply row, out of sequence.
const QUEUE_KEYS: ActionKey[] = ["queue-fit", "tailor"];
const QUEUE_ACTIONS: { key: ActionKey; label: string }[] = [
  { key: "queue-fit", label: "Fit assessment" },
  { key: "tailor", label: "Resume tailoring" },
];
// Candidate (pre-tracker) states — the rows for which queueing fit/tailoring is meaningful. Tracker
// rows (applied/interviewing/closed) have graduated past this, so they get no Queue section.
const CANDIDATE_STATES = new Set(["matched", "review", "fit_queue", "assessed", "tailoring", "tailored", "apply_later", "dismissed", "filtered"]);
// Where each quick action lands a scan-stage row (mirrors scannedAction server-side). Lets the table
// update in place: if the new state still belongs to the open step (queue-fit: review → fit_queue,
// both Fit Assessment) the row just changes state; otherwise it drops out. Either way we skip the full
// re-fetch, so the surrounding rows don't flash or re-sort under you.
const ACTION_RESULT_STATE: Record<ActionKey, string> = {
  "queue-fit": "fit_queue",
  discard: "dismissed",
  tailor: "tailoring",
  apply: "applied",
};

// Text color per tone — for the ⋯ menu items (the inline Btn uses its own fuller styling).
const TONE_TEXT: Record<string, string> = {
  emerald: "text-emerald-300", sky: "text-sky-300", amber: "text-amber-300", rose: "text-rose-300",
};

// Action button presentation, looked up from a step's `actions` list. A Bot icon = the agent does it
// (the hand-off); a trailing → (`arrow`) = the action advances the row to the next stage. Holds
// (Apply later) and drops (Discard) carry neither.
const ACTION_META: Record<ActionKey, { label: string; tone: "emerald" | "rose" | "sky" | "amber"; title: string; icon?: typeof Bot; arrow?: boolean }> = {
  "queue-fit": { label: "Assess fit", tone: "sky", title: "Hand off to the agent — assess fit → next stage", icon: Bot, arrow: true },
  tailor: { label: "Tailor", tone: "sky", title: "Hand off to the agent — tailor a resume → next stage", icon: Bot, arrow: true },
  apply: { label: "Mark applied", tone: "emerald", title: "Mark applied → moves to the tracker", icon: Check, arrow: true },
  discard: { label: "Discard", tone: "rose", title: "Discard — won't resurface", icon: Trash2 },
};

// "Move to…" jumps a posting straight to any stage, OUT of sequence — surfaced in the ⋯ menu on every
// row (e.g. send a fresh match straight to Applied). Each target is a stage's canonical landing
// state; a row's own stage is hidden from its menu (see STATE_STAGE below). One PATCH to the unified
// posting endpoint handles the move in any stage; the matching side effects mirror the drawer's
// selector (stamp the applied date, flag interviewed).
const MOVE_TARGETS: { label: string; state: string; stage: string }[] = [
  { label: "Fit assessment", state: "review", stage: "fit" },
  { label: "Tailor resume", state: "tailoring", stage: "tailor" },
  { label: "Apply later", state: "apply_later", stage: "later" },
  { label: "Applied", state: "applied", stage: "applied" },
  { label: "Interviewing", state: "interview", stage: "interview" },
  { label: "Rejected", state: "rejected", stage: "closed" },
  { label: "Discarded", state: "dismissed", stage: "dismissed" },
];

type Scanned = {
  id: number; company: string; title: string; location: string | null; url: string | null;
  department: string | null; verdict: string; reason: string | null; state: string; scannedAt: string; updatedAt?: string | null;
  fitScore?: number | null; fit?: FitAssessment; resumeDir?: string | null; leveling?: Leveling; redoLog?: RedoTurn[]; comments?: Comment[]; pinned?: boolean;
};

// One row model for the table, whichever source a step reads (candidate scan store or the tracker).
// `state` is the row's real candidate state — drives its per-row actions within a grouped stage.
// `posting` is set only for tracker rows — it's the full record the drawer manages on row click.
type FRow = {
  id: number; state: string; company: string; title: string; url: string | null; location: string | null;
  department?: string | null; fitScore: number | null; fit?: FitAssessment; resumeDir?: string | null;
  leveling?: Leveling; verdict?: string; reason?: string | null; redoLog?: RedoTurn[]; comments?: Comment[];
  status?: Posting["status"]; appliedDate?: string; updatedAt?: string; discoveredAt?: string; posting?: Posting;
  // When this row entered its current stage (last state change, else first-scan/discovery) — drives the NEW tag.
  addedAt?: string | null;
  // When the posting was first scanned/discovered — drives the "scanned … ago" line in the company cell.
  scannedAt?: string | null;
  pinned?: boolean; // user-pinned → floats to the top of its stage table
};
const fromScanned = (p: Scanned): FRow => ({
  id: p.id, state: p.state, company: p.company, title: p.title, url: p.url, location: p.location, department: p.department,
  fitScore: p.fitScore ?? null, fit: p.fit, resumeDir: p.resumeDir, leveling: p.leveling, verdict: p.verdict, reason: p.reason, redoLog: p.redoLog, comments: p.comments,
  addedAt: p.updatedAt ?? p.scannedAt, scannedAt: p.scannedAt, pinned: p.pinned ?? false,
});
const fromPosting = (p: Posting): FRow => ({
  id: Number(p.id), state: p.status, company: p.company, title: p.role, url: p.url ?? null, location: p.location ?? null,
  fitScore: p.fitScore ?? null, fit: p.fit, resumeDir: p.resumeDir ?? null, leveling: p.leveling, redoLog: p.redoLog, comments: p.comments,
  status: p.status, appliedDate: p.appliedDate, updatedAt: p.updatedAt, discoveredAt: p.discoveredAt, posting: p,
  addedAt: p.updatedAt ?? p.discoveredAt ?? p.appliedDate, scannedAt: p.discoveredAt ?? null, pinned: p.pinned ?? false,
});

// "New" = entered its current stage within the last day (today or yesterday). updatedAt is
// day-granular (set on every state move), scannedAt/discoveredAt are full ISO — normalize both to a
// calendar-day diff so the tag reads the same regardless of source. Drives the NEW badge + top sort.
const NEW_WINDOW_DAYS = 1;
function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(ms) ? null : Math.floor((Date.now() - ms) / 86_400_000);
}
const isNewRow = (p: FRow): boolean => {
  const d = daysSince(p.addedAt);
  return d !== null && d <= NEW_WINDOW_DAYS;
};

// Compact relative age — m / h / d / mo ago — for the "scanned … ago" line in the company cell.
// Handles both full ISO (scan store) and date-only (discoveredAt) by normalizing to UTC midnight.
function relAge(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(ms)) return null;
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
}

// Short, locale-independent day label (e.g. "Jun 26") — UTC so server/client render identically (no
// hydration mismatch). Used for the "last tailored" line under the résumé link.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDay(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// Friendly label for a résumé slug (e.g. "acme-senior-123/v2" → "tailored-v2"). The full slug
// stays in the cell's title for reference; the version suffix is the only part worth showing inline.
function resumeLabel(dir: string): string {
  const m = dir.match(/v(\d+)\s*$/i);
  return m ? `tailored-v${m[1]}` : "tailored";
}

type SortDir = "asc" | "desc";
type Sort = { key: string; dir: SortDir };
// Columns that carry no orderable value — clicking their header does nothing.
const UNSORTABLE = new Set(["act", "sel"]);

// A company's level ceiling on the normalized 1–10 scale — the top of its highest band. Used to
// order the Lvl column; no ladder sinks to the bottom.
function levelCeil(l?: Leveling | null): number {
  if (!hasLadder(l)) return -Infinity;
  return Math.max(...Object.values(l.ladder!).map(([, hi]) => hi));
}

// Sort key for a row, per column — one function over the unified FRow (covers both sources).
function sortVal(p: FRow, key: string): string | number {
  switch (key) {
    case "company": return p.company.toLowerCase();
    case "title": return p.title.toLowerCase();
    case "lvl": return levelCeil(p.leveling);
    case "fit": return p.fitScore ?? -Infinity;
    case "location": return (p.location ?? "").toLowerCase();
    case "gaps": return p.fit?.gaps?.length ?? 0;
    case "resume": return (p.resumeDir ?? "").toLowerCase();
    case "status": return p.status ?? "";
    case "applied": return p.appliedDate ?? "";
    case "updated": return p.updatedAt ?? "";
    default: return "";
  }
}
// Display/sort date for a tracker row — application date, else last-updated/discovered.
const rowDate = (p: FRow): string => p.appliedDate ?? p.updatedAt ?? p.discoveredAt ?? "";

// Gmail deep-links. Prefer a DIRECT link to the exact thread when inbox-sync captured its id; else
// fall back to a stage-specific search that lands on the relevant thread(s).
const gmailThread = (id: string) => `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`;
const gmailSearch = (q: string) => `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}`;
// A link for one stage: the direct thread if `id` is set, otherwise the search query. `direct` drives
// the icon/tooltip so you can tell an exact-email link from a search.
const stageLink = (label: string, id: string | undefined, query: string): { label: string; url: string; direct: boolean } =>
  id ? { label, url: gmailThread(id), direct: true } : { label, url: gmailSearch(query), direct: false };
// Stage-specific "find the email" links for a tracker row's status — applied → confirmation, closed →
// rejection, interview → one link per round (kind-specific), offer → offer. Empty for pre-apply rows.
function stageEmailLinks(p: FRow): { label: string; url: string; direct: boolean }[] {
  const base = `${p.company} ${p.title}`.trim();
  const refs = p.posting?.emailRefs;
  switch (p.status) {
    case "applied":
      return [stageLink("confirmation", refs?.applied, `${base} (application OR applied OR "thank you for applying" OR received)`)];
    case "interview": {
      const rounds = p.posting?.interviews ?? [];
      if (rounds.length)
        return rounds.map((r, i) =>
          stageLink(
            r.kind ? String(r.kind) : `round ${r.round ?? i + 1}`,
            r.emailId,
            `${base} (${r.kind ?? "interview"} OR interview OR schedule OR invitation OR availability)`,
          ),
        );
      return [stageLink("interview", refs?.interview, `${base} (interview OR schedule OR invitation OR availability)`)];
    }
    case "offer":
      return [stageLink("offer", refs?.offer, `${base} (offer OR congratulations OR "pleased to")`)];
    case "rejected":
      return [stageLink("rejection", refs?.rejected, `${base} (unfortunately OR "not moving forward" OR "other candidates" OR regret OR decided)`)];
    default:
      return [];
  }
}

// Default order for the Fit Assessment tab: un-queued review matches first (your triage), then
// queued (waiting on the agent), then assessed by score (highest first). Ascending sort.
const fitRank = (p: FRow): number =>
  p.fitScore != null ? 1000 - p.fitScore : p.state === "review" || p.state === "matched" ? 0 : 1;

// Stable comparator: numbers numerically, everything else lexicographically, scaled by direction.
function cmp(a: string | number, b: string | number, dir: SortDir): number {
  const d = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return dir === "asc" ? d : -d;
}

const FILTER_KEY = "pipeline:filter"; // localStorage key for the committed filter chips
// localStorage key for the active step. JSON-encoded (usePersistentState) — the pre-2026-08 raw
// string is unparseable and falls back to the default step once, then re-saves on the next pick.
const STEP_KEY = "landed.pipeline.step";
// Reverse index: a candidate/tracker state → the spine step it lives under. Lets the "Move to" menu
// hide the stage a row already sits in, so the menu only offers real jumps.
const STATE_STAGE: Record<string, string> = {};
for (const s of ALL_STEPS) for (const st of s.states) STATE_STAGE[st] = s.key;

export default function Pipeline() {
  const {
    postings, loading, reload, setStatus, setInterviewed, setCompanyTier, setCompanyDesire,
    setWatchlist, setField, renameCompany, moveJob, deleteJob,
  } = useApplications();
  const { jobs, add, bump, redoNoteFor, isWorking, isQueued, inboxLastSynced } = useAgentQueue();
  // Moving a posting into "Applied" opens a small prompt to capture (or update) the real applied
  // date — kept distinct from the status change itself. `askAppliedDate` resolves with the chosen
  // date, or null if the user cancels (which aborts the whole move).
  const [appliedAsk, setAppliedAsk] = useState<{ existing?: string; resolve: (d: string | null) => void } | null>(null);
  const askAppliedDate = (existing?: string) => new Promise<string | null>((resolve) => setAppliedAsk({ existing, resolve }));
  const resolveApplied = (d: string | null) => { setAppliedAsk((cur) => { cur?.resolve(d); return null; }); };
  // Transient toast (bottom-center), e.g. "fit already queued — skipped". Not a modal — it never
  // blocks. Auto-dismisses; a new message replaces the old one.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  // Moving a posting whose queued tailoring job would be dropped opens a 3-way confirm (Drop / Keep /
  // Cancel). `askDropTailoring` resolves with the choice; guardTailoringDrop (below) turns it into the
  // extra PATCH body, or null to abort the move.
  const [dropAsk, setDropAsk] = useState<{ company: string; role: string; target: string; resolve: (v: "drop" | "keep" | "cancel") => void } | null>(null);
  const askDropTailoring = (info: { company: string; role: string; target: string }) =>
    new Promise<"drop" | "keep" | "cancel">((resolve) => setDropAsk({ ...info, resolve }));
  const resolveDrop = (v: "drop" | "keep" | "cancel") => { setDropAsk((cur) => { cur?.resolve(v); return null; }); };
  // A queued (not-yet-claimed) tailoring job is what a status move would silently drop; an in-progress
  // one survives. Moving INTO the tailor stage keeps/enqueues, so only guard exits. Returns the extra
  // PATCH body ({} normally, { keepTailoringJob:true } to spare it), or null to abort.
  const guardTailoringDrop = useCallback(async (id: string, company: string, role: string, targetState: string): Promise<Record<string, unknown> | null> => {
    const willDrop = targetState !== "tailoring" && isQueued(id, "tailor") && !isWorking(id, "tailor");
    if (!willDrop) return {};
    const label = MOVE_TARGETS.find((t) => t.state === targetState)?.label ?? targetState;
    const choice = await askDropTailoring({ company, role, target: label });
    if (choice === "cancel") return null;
    return choice === "keep" ? { keepTailoringJob: true } : {};
  }, [isQueued, isWorking]);
  // Whether an inbox-sync job is already outstanding (queued or claimed) — one at a time is enough.
  // `syncStartedAt` covers the gap between clicking and the queue re-fetch so a fast double-click
  // can't stack two jobs. It's a TIMESTAMP, not a flag: "the queued job showed up" can't be the only
  // release, because a deduped daily POST and a job drained inside the poll gap both queue nothing
  // the poll will ever see — which used to leave the button disabled for the rest of the day.
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);
  // Inbox sync needs Gmail wired — grey the button out until it is. Start `true` to avoid a disabled
  // flash before the check resolves; re-check on focus (so connecting Gmail elsewhere frees it).
  const [gmailReady, setGmailReady] = useState(true);
  useEffect(() => {
    const check = () => fetch("/api/gmail").then((r) => r.json()).then((d) => setGmailReady(!!d.connected)).catch(() => {});
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);
  // One-click "Update interview status" fan-out — POST the orchestrator, then refresh queue + board.
  const [updating, setUpdating] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const runInterviewUpdate = async () => {
    if (updating) return;
    setUpdating(true);
    setUpdateNote(null);
    try {
      const r = await fetch("/api/interview-status-update", { method: "POST" }).then((x) => x.json()).catch(() => null);
      bump();
      reload();
      if (r && typeof r.companies === "number") {
        const bits = [`${r.companies} ${r.companies === 1 ? "company" : "companies"}`];
        if (r.researchQueued) bits.push(`${r.researchQueued} new research`);
        if (r.inboxSync) bits.push("inbox sync");
        setUpdateNote(`Queued: ${bits.join(" · ")}`);
      }
    } finally {
      setUpdating(false);
    }
  };
  const inboxSyncQueued = jobs.some((j) => j.type === "inbox-sync");
  // Drop the optimistic timestamp once the queued job actually appears — the job itself is now the
  // signal, so the button stays busy for as long as the work really is outstanding.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (inboxSyncQueued) setSyncStartedAt(null); }, [inboxSyncQueued]);
  // …and expire it on a timer if no job ever shows up, so the button always recovers. A timer rather
  // than a `Date.now()` comparison in render, which would make render impure.
  useEffect(() => {
    if (syncStartedAt === null) return;
    const t = setTimeout(() => setSyncStartedAt(null), INBOX_SYNC_PENDING_GRACE_MS);
    return () => clearTimeout(t);
  }, [syncStartedAt]);
  // The button's busy state. A live `syncStartedAt` is always within the grace window (the effect
  // above clears it), so this is `inboxSyncPending` with the clock already accounted for.
  const syncing = inboxSyncQueued || syncStartedAt !== null;

  // Daily auto-sync: opt-in + time-of-day configured on /settings (this page only reflects the state
  // + runs the timer). When on, an in-app timer queues an inbox-sync at the scheduled local time, so
  // starting the app doesn't queue one. The app is always-on, so a minute tick is enough to hit the
  // scheduled minute; the decision is the pure `shouldAutoSyncInbox`, keeping the effect a thin
  // trigger. AutoWorkController drains what it queues.
  //
  // "At most once a day" is enforced SERVER-side, by the day-keyed job id (`/api/inbox-sync/daily`
  // + `enqueueDailyInboxSync`) — the client-side guards below are React state and can't see a
  // double-invoked effect, a second tab, or a tick landing inside the 25s queue-poll gap, all of
  // which used to stack duplicate syncs. The ref stops this tab re-POSTing a day it already sent.
  const [dailySync] = usePersistentState<boolean>(INBOX_DAILY_SYNC_KEY, false);
  const [dailySyncAt] = usePersistentState<string>(INBOX_SYNC_TIME_KEY, DEFAULT_INBOX_SYNC_TIME);
  const autoSyncSent = useRef<string | null>(null);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      // Re-check the latch against a real clock instead of trusting the expiry timer: a backgrounded
      // tab throttles timers, so `syncStartedAt` can still be set long after it should have lapsed.
      const outstanding = inboxSyncPending({ startedAt: syncStartedAt, outstanding: inboxSyncQueued, now: now.getTime() });
      if (!shouldAutoSyncInbox({ enabled: dailySync, at: dailySyncAt, lastSynced: inboxLastSynced, outstanding, now })) return;
      const id = dailySyncJobId(now, dailySyncAt);
      if (autoSyncSent.current === id) return; // already sent today's from this tab
      autoSyncSent.current = id;
      setSyncStartedAt(now.getTime());
      fetch("/api/inbox-sync/daily", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) })
        .then((r) => r.json())
        // `queued: false` = the server already has today's row, so no job will ever reach the queue.
        // Release the optimistic latch now rather than making the button wait out the grace window.
        .then((d) => { if (d?.queued) pendo.track("inbox_sync_queued", { auto: true }); else setSyncStartedAt(null); })
        .catch(() => { autoSyncSent.current = null; setSyncStartedAt(null); }) // let a later tick retry a failed POST
        .finally(() => bump()); // pulse + refresh the queue, same as a manual add
    };
    tick(); // check on mount / whenever inputs change (sync drained, toggle or time changed)
    const iv = setInterval(tick, 60_000); // per-minute — hit the scheduled time without a tab focus
    return () => clearInterval(iv);
  }, [dailySync, dailySyncAt, inboxLastSynced, inboxSyncQueued, syncStartedAt, bump]);
  // A stable signature of the live queue — changes only when a job is added/removed/drained, not on
  // every poll. Deleting a queued fit/tailoring job un-queues its candidate server-side (fit_queue →
  // review, tailoring → assessed), so the funnel must re-read to move that row out of its stage.
  const jobKey = jobs.map((j) => j.id).sort().join(",");

  // Active spine step + its table state. Persisted so a refresh — or leaving for another page and
  // coming back — keeps you on the same step. Read as an external store, so the FIRST client render
  // already has the persisted step: restoring it in a mount effect instead made the page load the
  // default step's rows and then render that response under the restored step.
  const [storedStep, setStoredStep] = usePersistentState<string>(STEP_KEY, DEFAULT_STEP);
  const tab = useMemo(() => resolveStep(storedStep), [storedStep]); // a step that no longer exists (or a corrupt value) → default
  // Bulk selection: the set of selected row ids (checkbox column). Cleared whenever the step changes
  // so a selection never leaks across stages. The bulk-action bar (bottom-center) appears when non-empty.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => {
    // Reacting to the step changing (an external value), not a cascading render off our own state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(new Set());
  }, [tab]);
  const toggleSel = useCallback((id: number) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  }), []);
  const clearSel = useCallback(() => setSelected(new Set()), []);
  const pickStep = (key: string) => setStoredStep(key);
  // Filter tags (committed chips) + the in-progress draft. The effective filter is tags + draft (OR),
  // applied across ALL stages: it filters the active table AND drives the spine's filtered counts.
  // The committed chips persist (FILTER_KEY); the live draft is transient.
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const saveTags = (next: string[]) => {
    setTags(next);
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const addTag = (t: string) => { const v = t.trim(); if (v && !tags.includes(v)) saveTags([...tags, v]); setDraft(""); };
  const removeTag = (t: string) => saveTags(tags.filter((x) => x !== t));
  const clearFilter = () => { saveTags([]); setDraft(""); };
  // Company picker — the same chips, chosen from a list instead of typed. A company counts as picked
  // when a chip names it exactly (case-insensitively); toggling off drops every chip that does.
  const [pickerAt, setPickerAt] = useState<{ x: number; y: number } | null>(null);
  const isPicked = (c: string) => tags.some((t) => t.toLowerCase() === c.toLowerCase());
  const togglePicked = (c: string) => {
    if (isPicked(c)) saveTags(tags.filter((t) => t.toLowerCase() !== c.toLowerCase()));
    else saveTags([...tags, c]);
  };
  // Restore the committed filter chips on mount (same SSR-safe pattern as the step above).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || "[]") as unknown;
      const f = Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string") : [];
      // Hydration-safe rehydrate: SSR/first render starts with no chips, then we restore the persisted
      // filter after mount (avoids a mismatch).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (f.length) setTags(f);
    } catch { /* ignore */ }
  }, []);
  // Effective filter terms (committed tags + the live draft), lowercased — drives the table filter
  // AND the spine's filtered counts. `termKey` is a stable dep string for effects.
  const terms = useMemo(() => [...tags, draft.trim()].filter(Boolean).map((t) => t.toLowerCase()), [tags, draft]);
  const termKey = terms.join("");
  const filtering = terms.length > 0;
  const [scanRows, setScanRows] = useState<Scanned[] | null>(null);
  const rowsReq = useRef(0); // sequence number of the in-flight rows fetch — see loadRows
  const [bucketCounts, setBucketCounts] = useState<Record<string, number> | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [sort, setSort] = useState<Sort | null>(null);
  const [closedFilter, setClosedFilter] = useState<ClosedFilterState>(NO_CLOSED_FILTER); // Closed step sub-filter: outcome × interviewed

  // Leveling reference (one fetch) flows to both the editor panel and the funnel's level popover.
  const [levelingRef, setLevelingRef] = useState<LevelingRef | null>(null);

  // Company drawer — the manager for tracker rows (status/tier/interviewed/edit/rename/delete).
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const selectJob = (p: Posting) => { setScanPosting(null); setSelectedCompany(p.company); setSelectedJobId(p.id); };
  // A pre-apply candidate (scan-stage row, e.g. tailoring) opened in the editable drawer. Tracker
  // rows come from `postings`; scan rows aren't in that set, so we fetch the full posting by id.
  const [scanPosting, setScanPosting] = useState<Posting | null>(null);
  // Inline row editing — click the row's edit pencil to edit company/title/location in place (instead
  // of opening the drawer). One row at a time; `editDraft` holds the working values until Save.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ company: string; title: string; location: string }>({ company: "", title: "", location: "" });
  // Resume diff modal — opened from the Tailor step's resume cell (and the drawer's resume row).
  // Track the row's posting id alongside the slug so the modal can offer "redo with a note".
  const [peerOpen, setPeerOpen] = useState(false);
  const [diffSlug, setDiffSlug] = useState<string | null>(null);
  const [diffPostingId, setDiffPostingId] = useState<string | null>(null);
  const [diffAnnotated, setDiffAnnotated] = useState<RedoTurn["diff"]>(undefined);

  useEffect(() => {
    // The leveling reference (edited on /settings) drives the level popover here.
    fetch("/api/leveling-ref").then((r) => r.json()).then((d) => setLevelingRef(d.ref ?? DEFAULT_LEVELING_REF)).catch(() => setLevelingRef(DEFAULT_LEVELING_REF));
  }, []);

  // Click a header: asc → desc → off. Switching tabs (below) clears it back to the default order.
  const toggleSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));

  const isTracker = isTrackerStep(tab);
  const scored = tab === "fit" || tab === "later"; // scored stages show the fit summary + sort by score
  const fcols = UNIFIED_COLS; // every step renders the same columns (first four frozen, rest scroll)

  const loadCounts = useCallback((qTerms: string[]) => {
    const qs = qTerms.length ? `&q=${encodeURIComponent(qTerms.join(","))}` : "";
    fetch(`/api/scanned?counts=1${qs}`).then((r) => r.json()).then((d) => setBucketCounts(d.counts)).catch(() => {});
  }, []);
  // Re-read counts on mount, when the queue set changes (a deleted job un-queues its candidate → it
  // moves stage), and when the filter terms change (so the spine shows filtered per-stage counts).
  // Debounced so typing into the filter doesn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => loadCounts(terms), 200);
    return () => clearTimeout(id);
  }, [loadCounts, termKey, jobKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRows = useCallback(() => {
    // Tracker steps read `postings`; the Scan Watchlist step shows watchlist + settings (no table).
    if (isTrackerStep(tab)) { rowsReq.current++; setScanRows([]); return; }
    // Only the LATEST request may write the table: stepping through stages faster than the fetches
    // come back would otherwise leave one stage's rows under another's heading.
    const req = ++rowsReq.current;
    fetch(`/api/scanned?state=${stepStates(tab).join(",")}`)
      .then((r) => r.json())
      .then((d) => { if (req === rowsReq.current) setScanRows(d.postings ?? []); })
      .catch(() => { if (req === rowsReq.current) setScanRows([]); });
  }, [tab]);
  // Tab switch (and first mount): a fresh data set, so clear to the loading placeholder, then load.
  // Tab switch: clear to the loading placeholder then load the new step's rows; a one-shot reset on
  // tab change, not a render loop.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setScanRows(null); loadRows(); }, [loadRows]);
  // A JD was pasted via the global "Add job" modal (nav rail or this page) — the new candidate lands
  // in fit_queue, so refresh the tracker postings and the active step's rows to surface it at once.
  useEffect(() => {
    const onAdded = () => { reload(); loadRows(); };
    window.addEventListener(JOB_ADDED_EVENT, onAdded);
    return () => window.removeEventListener(JOB_ADDED_EVENT, onAdded);
  }, [reload, loadRows]);
  // `jobKey` change (a queued fit/tailoring job was claimed/deleted — e.g. delete un-queues its
  // candidate server-side: fit_queue → review, tailoring → assessed) re-reads the active step's rows
  // so it drops/updates without a manual tab switch. Do it SILENTLY — load in place WITHOUT clearing to
  // null (which collapses the table to the "loading…" placeholder and snaps the scroll back to the top).
  // Skip the initial mount; the tab effect above already did the first load.
  const jobKeyFirst = useRef(true);
  useEffect(() => {
    if (jobKeyFirst.current) { jobKeyFirst.current = false; return; }
    loadRows();
  }, [jobKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tabs have different columns — a sort key from one needn't exist in the next, so reset.
  // Reset the sort when the tab changes (a sort key from one tab needn't exist in the next); a
  // one-shot reset on tab change, not a render loop.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setSort(null), [tab]);

  // Every company the filter can reach, for the picker: the tracker spans all stages, `scanRows` adds
  // the loaded scan step's rows (whose companies may not be tracked yet). Deduped case-insensitively
  // on first-seen spelling, A→Z.
  const companyOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of [...postings.map((p) => p.company), ...(scanRows ?? []).map((r) => r.company)]) {
      const k = c?.trim().toLowerCase();
      if (k && !seen.has(k)) seen.set(k, c.trim());
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [postings, scanRows]);

  // The "filter by company…" box matches on COMPANY ONLY (callers pass just p.company), so a term
  // like "senior" or a location never surfaces unrelated companies.
  const matches = (...parts: (string | null | undefined)[]) => {
    if (terms.length === 0) return true;
    const hay = parts.filter(Boolean).join(" ").toLowerCase();
    return terms.some((t) => hay.includes(t));
  };

  // Postings in the active tracker step (before the free-text/closed sub-filter). Closed collapses
  // several outcomes, so it offers a per-status chip filter.
  const trackerBase = isTracker ? postings.filter((p) => columnOf(p) === STEP_COLUMN[tab]) : [];
  const closedPresent = tab === "closed" ? statusesForColumn("closed").filter((s) => trackerBase.some((p) => p.status === s)) : [];
  // Narrowed so a selection can never point at an empty table (a status that's since drained away,
  // or "interviewed" within an outcome that has none) — see resolveClosedFilter.
  const effClosed = tab === "closed" ? resolveClosedFilter(trackerBase, closedFilter) : NO_CLOSED_FILTER;
  const trackerPostings = tab === "closed" ? applyClosedFilter(trackerBase, effClosed) : trackerBase;

  // The active step's rows, normalized to one model.
  const raw: FRow[] | null = isTracker
    ? trackerPostings.map(fromPosting)
    : scanRows == null ? null : scanRows.map(fromScanned);
  const rows = raw == null ? null : raw
    .filter((p) => matches(p.company))
    // Click-to-sort wins; else the per-step default — but newly-arrived rows always float to the top
    // first (so what the agent just added in this stage is the first thing you see), then the per-step
    // default (tracker = newest, Fit = un-queued review first, then queued, then assessed by score).
    .sort((a, b) => {
      // Pinned rows always lead the table — even over an explicit click-sort.
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      if (sort) return cmp(sortVal(a, sort.key), sortVal(b, sort.key), sort.dir);
      const an = isNewRow(a), bn = isNewRow(b);
      if (an !== bn) return an ? -1 : 1; // new rows first
      return isTracker ? rowDate(b).localeCompare(rowDate(a))
        : scored ? fitRank(a) - fitRank(b) : 0;
    });

  // Company-level "in tracker" tag (aggregated from real applications — no title matching).
  const trackedByCompany = new Map<string, { role: string; status: Posting["status"]; date?: string; appliedDate?: string; interviewed?: boolean }[]>();
  for (const p of postings) {
    const k = p.company.toLowerCase();
    const list = trackedByCompany.get(k) ?? [];
    list.push({ role: p.role, status: p.status, date: trackerDate(p), appliedDate: p.appliedDate, interviewed: p.interviewed });
    trackedByCompany.set(k, list);
  }
  const renderCompany = (name: string) => (
    <>
      <span className="block truncate">{name}</span>
      <TrackerTag items={trackedByCompany.get(name.toLowerCase()) ?? []} />
    </>
  );

  // `queueOnly` (the ⋯ "Queue" section) hands fit/tailor work to the agent WITHOUT moving the posting's
  // stage — actions are decoupled from status tracking. The default (inline quick buttons) still
  // advances the stage.
  const act = async (id: number, action: ActionKey, queueOnly = false) => {
    // Graceful in-place update — no full re-fetch. A row that stays in the open step (queue-fit:
    // review → fit_queue) just changes state; one that leaves (discard, tailor, apply) drops out.
    // The other rows keep their position instead of flashing/re-sorting. queueOnly never moves a row.
    const next = ACTION_RESULT_STATE[action];
    const stays = queueOnly || stepStates(tab).includes(next);
    const row = scanRows?.find((r) => r.id === id);
    // "Mark applied" is a move into Applied → capture the real applied date first (cancel aborts).
    // Scan-stage rows have never been applied, so this is always the fresh prompt (default today).
    let appliedDate: string | undefined;
    if (action === "apply") {
      const date = await askAppliedDate();
      if (date === null) return;
      appliedDate = date;
    }
    pendo.track("candidate_action_taken", {
      posting_id: id,
      company: row?.company,
      title: row?.title,
      action,
      queue_only: queueOnly,
      from_state: row?.state,
      to_state: queueOnly ? row?.state : next,
      pipeline_step: tab,
      fit_score: row?.fitScore,
    });
    // Skip the optimistic stage move for a queue-only hand-off — only the queued chip changes, and
    // that rides on the live queue (bump refreshes it below).
    if (!queueOnly) {
      setScanRows((rs) =>
        rs == null ? rs
          : stays ? rs.map((r) => (r.id === id ? { ...r, state: next } : r))
          : rs.filter((r) => r.id !== id)
      );
    }
    const r = await fetch(`/api/scanned/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, queueOnly, ...(appliedDate ? { appliedDate } : {}) }) }).catch(() => null);
    if (!r || !r.ok) { loadRows(); return; } // failed — reconcile the table from the server
    const d = await r.json().catch(() => ({}));
    if (d.fitAlreadyQueued) notify(`Fit assessment is already queued for ${row?.company ?? "this posting"} — skipped the duplicate.`);
    loadCounts(terms); // keep the spine badges accurate
    if (action === "queue-fit" || action === "tailor") bump(); // handed work to the agent — pulse the queue
  };

  // Jump a posting to ANY stage, out of sequence (the ⋯ "Move to" menu — works from every stage, e.g.
  // a fresh match straight to Applied). One PATCH to the unified posting (valid in any stage), filling
  // the same stage side effects as the drawer's selector: stamp the applied date on first apply, flag
  // interviewed on entering the loop. Then re-read counts + the active table + the tracker so the row
  // leaves its old stage and lands in the new one.
  const moveTo = async (p: FRow, state: string) => {
    if (p.state === state) return;
    // Applied is special: capture the real applied date (or confirm/keep an existing one) before we
    // move. Cancelling the prompt aborts the move entirely.
    let extra: Record<string, unknown> = {};
    if (state === "applied") {
      const date = await askAppliedDate(p.appliedDate);
      if (date === null) return;
      extra = { appliedDate: date };
    } else if (state === "interview") {
      extra = { interviewed: true };
    }
    // If a queued tailoring job would be dropped by this move, confirm (Drop / Keep / Cancel).
    const guard = await guardTailoringDrop(String(p.id), p.company, p.title, state);
    if (guard === null) return; // cancelled
    extra = { ...extra, ...guard };
    pendo.track("candidate_moved_to_stage", {
      posting_id: p.id,
      company: p.company,
      title: p.title,
      from_state: p.state,
      to_state: state,
      target_stage: MOVE_TARGETS.find((t) => t.state === state)?.label,
    });
    setScanRows((rs) => (rs ? rs.filter((r) => r.id !== p.id) : rs)); // optimistic for scan-stage rows
    const r = await fetch(`/api/applications/${p.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: state, ...extra }),
    }).catch(() => null);
    if (!r || !r.ok) { loadRows(); return; } // failed — reconcile the active scan table from the server
    loadCounts(terms);
    reload(); // refresh the tracker postings — the row may now live in a tracker step (the open scan table is already updated optimistically)
  };

  // Drawer stage selector for tracker postings. Same as the hook's setStatus, but gates the move to
  // Applied behind the applied-date prompt so the date is captured (or updated), never silently
  // stamped to today.
  const setStatusGuarded = async (p: Posting, to: Status) => {
    if (p.status === to) return;
    const guard = await guardTailoringDrop(String(p.id), p.company, p.role, to);
    if (guard === null) return; // cancelled
    let extra: Record<string, unknown> = {};
    if (to === "applied") {
      const date = await askAppliedDate(p.appliedDate);
      if (date === null) return;
      extra = { appliedDate: date };
    }
    if (guard.keepTailoringJob) {
      // The hook's setStatus can't carry a control flag, so PATCH directly to spare the job, then reconcile.
      await fetch(`/api/applications/${p.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: to, ...extra, keepTailoringJob: true }) }).catch(() => null);
      reload();
    } else {
      setStatus(p, to, extra.appliedDate ? { appliedDate: extra.appliedDate as string } : undefined);
    }
  };

  // Pin/unpin a posting → it floats to the top of its stage table. Tracker rows go through the
  // optimistic useApplications path; scan-stage rows PATCH directly (they aren't in `postings`).
  const togglePin = async (p: FRow) => {
    const next = !p.pinned;
    if (p.posting) { setField(p.posting, { pinned: next }); return; }
    setScanRows((rs) => (rs ? rs.map((r) => (r.id === p.id ? { ...r, pinned: next } : r)) : rs)); // optimistic
    await fetch(`/api/applications/${p.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pinned: next }),
    }).catch(() => {});
    loadRows();
  };

  // Inner content per column, over the unified row. The <Td> wrapper (width bounds + class) is
  // applied by the row map below, so this just returns what goes inside the cell.
  // Standard work-status for a row's fit/tailor phase: in-progress (an agent claimed the job) wins,
  // then a queued redo, then the state-based queued status. Drives the unified JobStatusChip below.
  // An outstanding fit/tailor job wins even when the posting's stage doesn't say so — a fit/tailor can
  // be queued out of sequence (a re-assess or re-tailor from a later stage), which no longer moves the
  // stage. So read "queued" off the live queue (isQueued), falling back to the stage as a backstop.
  const fitStatusOf = (p: FRow): WorkStatus | null =>
    isWorking(String(p.id), "fit") ? "in_progress"
      : redoNoteFor(String(p.id), "fit") !== null ? "queued_redo"
      : (isQueued(String(p.id), "fit") || p.state === "fit_queue") ? "queued_fit" : null;
  const tailorStatusOf = (p: FRow): WorkStatus | null =>
    isWorking(String(p.id), "tailor") ? "in_progress"
      : redoNoteFor(String(p.id), "tailor") !== null ? "queued_redo"
      : (isQueued(String(p.id), "tailor") || (p.state === "tailoring" && !p.resumeDir)) ? "queued_tailor" : null;

  // Inline-edit input for an editing row's company/title/location cells. Enter saves, Escape cancels;
  // clicks are kept off the row (which would open the drawer).
  const editInput = (field: "company" | "title" | "location", p: FRow, placeholder: string) => (
    <input
      value={editDraft[field]}
      autoFocus={field === "company"}
      onChange={(e) => setEditDraft((d) => ({ ...d, [field]: e.target.value }))}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(p); else if (e.key === "Escape") cancelEdit(); }}
      placeholder={placeholder}
      className="w-full min-w-0 rounded bg-zinc-900 px-1.5 py-0.5 text-[13px] text-zinc-200 outline-none ring-1 ring-inset ring-sky-500/60 focus:ring-sky-500 placeholder:text-zinc-600"
    />
  );

  const cellContent = (k: string, p: FRow): React.ReactNode => {
    const editing = editingId === p.id;
    switch (k) {
      case "sel":
        // Left gutter lives here (pl-3), NOT on the scroll container — so the frozen cell background
        // reaches the true left edge and the scrolling columns can't show through beside it.
        return (
          <span className="flex pl-3 pt-1">
            <input
              type="checkbox"
              checked={selected.has(p.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggleSel(p.id)}
              className="h-3.5 w-3.5 cursor-pointer accent-sky-500"
              aria-label="Select row"
            />
          </span>
        );
      case "company": {
        if (editing) return editInput("company", p, "company");
        const scanned = relAge(p.scannedAt);
        return (
          <span className="flex items-start gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); togglePin(p); }}
              title={p.pinned ? "Unpin" : "Pin to top"}
              className={`mt-0.5 shrink-0 transition ${p.pinned ? "text-amber-300" : "text-zinc-600 opacity-0 hover:text-zinc-300 group-hover:opacity-100"}`}
            >
              <Pin size={12} className={p.pinned ? "fill-amber-300/30" : ""} />
            </button>
            <span className="min-w-0 flex-1">
              {renderCompany(p.company)}
              {scanned && <span className="mt-0.5 block text-[11px] text-zinc-600">scanned {scanned}</span>}
            </span>
            {isNewRow(p) && <NewTag />}
          </span>
        );
      }
      case "title": return editing ? editInput("title", p, "title") : <Title text={p.title} url={p.url} />;
      case "lvl": return <LevelChip company={p.company} leveling={p.leveling} levelingRef={levelingRef ?? DEFAULT_LEVELING_REF} />;
      case "fit": {
        const ws = fitStatusOf(p);
        return (
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] leading-snug text-zinc-500">
            {p.fitScore != null && <span className={`rounded-full border px-1.5 py-0.5 text-[12px] font-medium tabular-nums ${fitColor(p.fitScore)}`}>{p.fitScore}</span>}
            {ws && <JobStatusChip status={ws} />}
            {p.fitScore == null && !ws && (p.state === "review" || p.state === "matched") && <span className="text-[12px] text-zinc-600">not assessed yet</span>}
            {p.fit?.summary && <span>{p.fit.summary}</span>}
          </div>
        );
      }
      case "location": return editing ? editInput("location", p, "location") : (p.location ?? "—");
      case "gaps": return (
        <span className="flex flex-wrap gap-1">
          {(p.fit?.gaps ?? []).map((g, i) => (
            <span key={i} title={g.detail} className={`rounded px-1.5 py-0.5 text-[12px] font-medium ${g.severity === "hard" ? "text-rose-300 bg-rose-500/15" : "text-amber-300 bg-amber-500/15"}`}>{g.text}</span>
          ))}
          {!p.fit?.gaps?.length && <span className="text-zinc-600">—</span>}
        </span>
      );
      case "resume": {
        const ws = tailorStatusOf(p);
        if (!p.resumeDir) return ws ? <JobStatusChip status={ws} /> : "—";
        const tailoredAt = lastTailoredAt(p.redoLog ?? []);
        return (
          <span className="flex flex-col gap-0.5">
            <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
              <button
                onClick={(e) => { e.stopPropagation(); setDiffSlug(p.resumeDir!); setDiffPostingId(String(p.id)); setDiffAnnotated(tailorDiffFor(p.redoLog ?? [], p.resumeDir!)); }}
                title={`Diff ${p.resumeDir} against the base resume`}
                className="inline-flex max-w-full items-center gap-1 truncate text-sky-300 transition hover:text-sky-400 hover:underline"
              >
                <GitCompareArrows size={12} className="shrink-0" /><span className="truncate">{resumeLabel(p.resumeDir)}</span>
              </button>
              {ws && <JobStatusChip status={ws} />}
            </span>
            {tailoredAt && <span className="text-[11px] text-zinc-600" title={shortDay(tailoredAt) ?? undefined}>tailored {relAge(tailoredAt)}</span>}
          </span>
        );
      }
      case "status": {
        // Pre-apply (scan-stage) rows have no tracker status yet.
        if (!p.status) return <span className="text-zinc-600">—</span>;
        const links = stageEmailLinks(p);
        return (
          <span className="flex flex-col items-start gap-1">
            <span className={`rounded px-1.5 py-0.5 text-[12px] font-medium ${STATUS_CHIP[p.status] ?? "text-zinc-400 bg-zinc-700/40"}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
            {links.map((l, i) => (
              <a
                key={i}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={l.direct ? `Open the ${l.label} email in Gmail` : `Search Gmail for the ${l.label} email`}
                className="inline-flex items-center gap-1 text-[11px] text-zinc-500 transition hover:text-sky-300"
              >
                <Mail size={10} className="shrink-0" /> {l.label} <ExternalLink size={9} className="shrink-0" />
              </a>
            ))}
          </span>
        );
      }
      case "applied": return p.appliedDate ?? "—";
      case "updated": return p.updatedAt ?? "—";
      case "comment": return <CommentCell id={p.id} comments={p.comments ?? []} onChanged={() => { reload(); loadRows(); }} />;
      case "act":
        if (editing) return (
          <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => saveEdit(p)} title="Save (Enter)" className="rounded-md p-1 text-emerald-300 ring-1 ring-inset ring-emerald-500/30 transition hover:bg-emerald-500/15"><Check size={14} /></button>
            <button onClick={cancelEdit} title="Cancel (Esc)" className="rounded-md p-1 text-zinc-400 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-800"><X size={14} /></button>
          </span>
        );
        return <ActionCell actions={ACTIONS_BY_STATE[p.state] ?? []} state={p.state} fitDone={p.fitScore != null || !!p.fit} resumeDone={!!p.resumeDir} onAct={(a, queueOnly) => act(p.id, a, queueOnly)} onMove={(s) => moveTo(p, s)} onEdit={() => startEdit(p)} />;
      default: return null;
    }
  };

  // Per-step badge count. When a filter is active it's the count of MATCHING postings in that step
  // (tracker steps filter the client-side `postings`; pre-apply steps read `bucketCounts`, which the
  // server already filtered by the same terms) — so the spine reads as a "where is this company?" map.
  const count = (s: SpineStep): number | undefined =>
    isTrackerStep(s.key)
      ? postings.filter((p) => columnOf(p) === STEP_COLUMN[s.key] && matches(p.company)).length
      : bucketCounts ? stepCount(s, bucketCounts) : undefined;
  const tableLoading = isTracker ? loading : scanRows === null;
  const empty = (!rows || rows.length === 0) && !tableLoading;

  // Drawer wiring — reuse the board aggregate so the drawer gets the whole company group.
  const companies = useMemo(() => aggregateCompanies(postings), [postings]);
  const companyGroup = companies.find((c) => c.company === selectedCompany) || null;
  const closeDrawer = () => { setSelectedCompany(null); setSelectedJobId(null); };

  // Open a pre-apply (scan-stage) row in the same drawer: fetch the full posting (it isn't in the
  // tracker `postings` set), clearing any tracker selection first.
  const openScanRow = async (id: number) => {
    setSelectedCompany(null); setSelectedJobId(null);
    const r = await fetch(`/api/applications/${id}`).catch(() => null);
    if (r?.ok) setScanPosting((await r.json()).posting ?? null);
  };
  // The scan-stage drawer edits persist by id through PATCH (works for any stage) and update the
  // drawer from the response; then we refresh the scan rows + counts so the funnel reflects it.
  const refreshScan = () => { loadRows(); loadCounts(terms); reload(); };

  // --- Bulk actions over the selected rows ---
  const visibleIds = (rows ?? []).map((r) => r.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = visibleIds.some((id) => selected.has(id));
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    visibleIds.forEach((id) => (allSelected ? n.delete(id) : n.add(id)));
    return n;
  });
  const afterBulk = () => { clearSel(); refreshScan(); };
  // State changes go through /api/applications/:id (works for a posting in ANY stage), so one path
  // covers discard + every "move to". Applied captures a single date for the whole batch.
  const bulkPatch = async (body: Record<string, unknown>) => {
    const ids = [...selected];
    await Promise.all(ids.map((id) => fetch(`/api/applications/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {})));
    afterBulk();
  };
  const bulkMove = async (state: string) => {
    let extra: Record<string, unknown> = {};
    if (state === "applied") { const d = await askAppliedDate(); if (d === null) return; extra = { appliedDate: d }; }
    else if (state === "interview") extra = { interviewed: true };
    pendo.track("bulk_action", { action: `move:${state}`, count: selected.size, step: tab });
    await bulkPatch({ status: state, ...extra });
  };
  const bulkDiscard = () => { pendo.track("bulk_action", { action: "discard", count: selected.size, step: tab }); return bulkPatch({ status: "dismissed" }); };
  // The agent hand-offs enqueue jobs, so they go through the scanned endpoint (which creates the fit/
  // tailoring job); then pulse the queue.
  const bulkHandoff = async (action: "queue-fit" | "tailor") => {
    pendo.track("bulk_action", { action, count: selected.size, step: tab });
    const ids = [...selected];
    await Promise.all(ids.map((id) => fetch(`/api/scanned/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }).catch(() => {})));
    bump();
    afterBulk();
  };
  const scanEdit = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`/api/applications/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (r?.ok) setScanPosting((await r.json()).posting ?? null);
    refreshScan();
  };
  // Inline row edit: open (seed the draft from the row), cancel, and save (PATCH only the changed
  // fields — works for BOTH scan-stage and tracker rows since /api/applications/:id handles any stage).
  const startEdit = (p: FRow) => { setScanPosting(null); setSelectedCompany(null); setSelectedJobId(null); setEditingId(p.id); setEditDraft({ company: p.company, title: p.title, location: p.location ?? "" }); };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = async (p: FRow) => {
    const body: Record<string, unknown> = {};
    if (editDraft.title.trim() && editDraft.title.trim() !== p.title) body.role = editDraft.title.trim();
    const loc = editDraft.location.trim() || null;
    if (loc !== (p.location ?? null)) body.location = loc;
    const co = editDraft.company.trim();
    if (co && co !== p.company) body.moveToCompany = co; // reassign this posting to that company (created if new)
    setEditingId(null);
    if (Object.keys(body).length) {
      pendo.track("posting_inline_edited", {
        posting_id: p.id,
        fields_changed: Object.keys(body).join(","),
      });
      await fetch(`/api/applications/${p.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
      refreshScan(); // refresh both the scan rows and the tracker postings + counts
    }
  };

  // A one-item company aggregate for the drawer (it renders just the focused posting now).
  const scanAgg: CompanyAgg | null = scanPosting
    ? { company: scanPosting.company, tier: scanPosting.tier, items: [scanPosting], newCount: 0, statusCounts: {}, skipped: false, watchlist: !!scanPosting.watchlist, desire: scanPosting.desire ?? null }
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden text-zinc-100">
        {/* The spine — fixed page chrome (pulled OUT of the scroll area), so the stage nav AND the
            sticky table header below both stay put while the rows scroll. */}
        <div className="shrink-0 border-b border-zinc-800/80 bg-[var(--background)] px-6 pb-4 pt-5">
          <div className="flex items-stretch overflow-x-auto pb-1">
            {SPINE.map((s, i) => {
              const n = count(s);
              return (
                <ArrowStep
                  key={s.key} step={s} first={i === 0} count={n} active={tab === s.key}
                  muted={filtering && (n ?? 0) === 0}
                  hit={filtering && (n ?? 0) > 0}
                  onClick={() => pickStep(s.key)}
                />
              );
            })}
          </div>
          {filtering && (() => {
            const total = SPINE.reduce((sum, s) => sum + (count(s) ?? 0), 0);
            const stages = SPINE.filter((s) => (count(s) ?? 0) > 0).length;
            return (
              <p className="mt-1 px-0.5 text-[12px] text-zinc-500">
                <span className="text-amber-300">{terms.join(", ")}</span> — {total} posting{total === 1 ? "" : "s"} across {stages} stage{stages === 1 ? "" : "s"}
              </p>
            );
          })()}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowArchive((v) => !v)}
              className="group flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wider text-zinc-500 transition hover:text-zinc-300"
            >
              <ChevronRight size={13} className={`transition-transform duration-200 ${showArchive ? "rotate-90" : ""}`} /> Archive
            </button>
            {showArchive && ARCHIVE.map((s) => <StepBtn key={s.key} step={s} count={count(s)} active={tab === s.key} onClick={() => pickStep(s.key)} />)}
            <div className="ml-auto flex items-center gap-2">
              {/* Compare comp across every active interviewing role — opens a popup with the raw
                  tracker data + an "Enrich with research" action. Scoped to the Interviewing view. */}
              {tab === "interview" && (
                <>
                  {updateNote && <span className="text-[12px] text-zinc-500">{updateNote}</span>}
                  {/* One-click: inbox-sync + per-company refresh folder / pull emails / research-if-new. */}
                  <button
                    onClick={runInterviewUpdate}
                    disabled={updating}
                    title="Update every interviewing company: sync inbox, refresh prep folders, pull interview emails, and research any not yet done"
                    className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-800 transition hover:text-zinc-100 hover:ring-zinc-700 disabled:cursor-default disabled:text-zinc-600 disabled:ring-zinc-800/60"
                  >
                    {updating ? <Loader2 size={13} className="animate-spin text-sky-300" /> : <RefreshCw size={13} className="text-sky-300" />}
                    {updating ? "Updating…" : "Update interview status"}
                  </button>
                  <button
                    onClick={() => setPeerOpen(true)}
                    title="Compare comp across every role you're actively interviewing for"
                    className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-800 transition hover:text-zinc-100 hover:ring-zinc-700"
                  >
                    <Coins size={13} className="text-violet-300" />
                    Compare comp
                  </button>
                </>
              )}
              {/* Queue an inbox-sync job for the agent (read Gmail → update statuses/interviews/dates).
                  Disabled while one is already outstanding so clicks don't stack duplicates. */}
              {/* Sync inbox. The subtext shows last-synced + whether daily auto-sync is configured
                  (a read-only reflection — configure it on /settings). */}
              {(() => { const queued = inboxSyncQueued || syncing; const noGmail = !gmailReady; const off = queued || noGmail; return (
              <button
                onClick={() => { if (!off) { setSyncStartedAt(Date.now()); add({ type: "inbox-sync" }); pendo.track("inbox_sync_queued"); } }}
                disabled={off}
                title={noGmail ? "Connect Gmail on the Settings page to sync your inbox" : queued ? "An inbox sync is already queued — run your agent queue" : `Queue an inbox sync for the agent — last synced ${fmtTs(inboxLastSynced)}${dailySync ? " · daily auto-sync on" : ""}`}
                className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-zinc-300 ring-1 ring-inset ring-zinc-800 transition hover:text-zinc-100 hover:ring-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:ring-zinc-800/60 disabled:hover:text-zinc-600"
              >
                <Mail size={13} className={off ? "text-zinc-600" : "text-sky-300"} />
                <span className="flex flex-col items-start leading-tight">
                  <span className="text-[13px] font-medium">{queued ? "Sync queued" : "Sync inbox"}</span>
                  <span className="flex items-center gap-1 text-[10px] font-normal text-zinc-500">
                    {dailySync && !noGmail && (
                      <span className="inline-flex items-center gap-0.5 text-sky-300/90" title="Daily auto-sync is on (configured in Settings)">
                        <span className="h-1 w-1 rounded-full bg-sky-400" />Daily
                      </span>
                    )}
                    {dailySync && !noGmail && <span className="text-zinc-700">·</span>}
                    {noGmail ? "Gmail not connected" : queued ? "in the agent queue" : inboxLastSynced ? `Synced ${ago(inboxLastSynced)}` : "Never synced"}
                  </span>
                </span>
              </button>
              ); })()}
              {/* Filter as deletable tags: type a company → Enter pins it as a chip; the filter
                  applies across ALL stages (table + the spine heatmap). Backspace on an empty box
                  removes the last chip. */}
              <div className="flex min-w-56 flex-wrap items-center gap-1 rounded-md bg-zinc-900 px-1.5 py-1 ring-1 ring-inset ring-zinc-800 transition focus-within:ring-zinc-600 hover:ring-zinc-700">
                {tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[12px] font-medium text-amber-200">
                    {t}
                    <button onClick={() => removeTag(t)} title="Remove" className="text-amber-300/70 hover:text-amber-100"><X size={11} /></button>
                  </span>
                ))}
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draft.trim()) { e.preventDefault(); addTag(draft); }
                    else if (e.key === "Backspace" && !draft && tags.length) { e.preventDefault(); removeTag(tags[tags.length - 1]); }
                  }}
                  placeholder={tags.length ? "" : "filter by company…"}
                  className="min-w-[7rem] flex-1 bg-transparent px-1 py-0.5 text-[13px] text-zinc-300 outline-none placeholder:text-zinc-600"
                />
                {/* Pick companies from a list instead of typing them — same chips either way. */}
                <button
                  onClick={(e) => setPickerAt(pickerAt ? null : anchorFrom(e))}
                  disabled={!companyOptions.length}
                  title={companyOptions.length ? "Pick companies" : "No companies yet"}
                  className="shrink-0 rounded p-0.5 text-zinc-500 transition hover:text-zinc-300 disabled:cursor-default disabled:text-zinc-700 disabled:hover:text-zinc-700"
                >
                  <ChevronDown size={13} />
                </button>
              </div>
              {pickerAt && (
                <PopoverPanel at={pickerAt} onClose={() => setPickerAt(null)} className="max-h-72 w-56 overflow-y-auto p-1">
                  {companyOptions.map((c) => {
                    const on = isPicked(c);
                    return (
                      <button
                        key={c}
                        onClick={() => togglePicked(c)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-zinc-300 transition hover:bg-zinc-800"
                      >
                        <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] ring-1 ring-inset ${on ? "bg-amber-500/80 ring-amber-400" : "ring-zinc-600"}`}>
                          {on && <Check size={10} className="text-zinc-950" />}
                        </span>
                        <span className="truncate">{c}</span>
                      </button>
                    );
                  })}
                </PopoverPanel>
              )}
              {filtering && (
                <button onClick={clearFilter} title="Clear filter" className="ml-1 text-zinc-500 hover:text-zinc-300">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Closed collapses several outcomes — offer a per-status sub-filter. Kept OUT of the scroll
            container below so it stays fixed instead of sliding horizontally with the table columns. */}
        {/* One outcome but some interviews still earns the row — that's the case the Interviewed
            pill is most useful in (an all-rejected Closed step). */}
        {tab === "closed" && (closedPresent.length >= 2 || trackerBase.some((p) => p.interviewed)) && (
          <div className="shrink-0 px-6 pt-4">
            <ClosedFilter present={closedPresent} base={trackerBase} active={effClosed} onChange={setClosedFilter} />
          </div>
        )}
        {/* The rows scroll here (both axes). The spine above is fixed chrome and the header is
            sticky-top, so only the body moves. NO padding on this container: any pad anchors the
            sticky columns inside it, leaving a strip the scrolling columns show through. The checkbox's
            left gutter lives INSIDE its cell instead (see the "sel" cell), so the frozen background
            still reaches x=0 and covers the scrolling content. */}
        <div className="flex-1 overflow-auto pb-8">
          <div className="pt-4">
            {tableLoading ? (
              <div className="flex items-center gap-2 py-8 text-[13px] text-zinc-500"><Loader2 size={14} className="animate-spin" /> loading…</div>
            ) : empty ? (
              <EmptyStateGetStarted />
            ) : (
              <table className="border-separate border-spacing-0 text-left" style={{ tableLayout: "fixed", width: fcols.reduce((s, k) => s + colW(k), 0) }}>
                <thead>
                  <tr>
                    {fcols.map((k) => (
                      <ResTh
                        key={k}
                        width={colW(k)}
                        style={headerStyle(k)}
                        className={isPinned(k) ? pinnedCls(k, false) : "bg-[var(--background)]"}
                        onSort={UNSORTABLE.has(k) ? undefined : () => toggleSort(k)}
                        sortDir={sort?.key === k ? sort.dir : null}
                      >{k === "sel"
                        ? <span className="flex pl-3">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                              onChange={toggleAll}
                              className="h-3.5 w-3.5 cursor-pointer accent-sky-500"
                              aria-label="Select all rows"
                            />
                          </span>
                        : FUNNEL_LABEL[k]}</ResTh>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(rows ?? []).map((p) => (
                    <tr
                      key={p.id}
                      onClick={editingId === p.id ? undefined : p.posting ? () => selectJob(p.posting!) : () => openScanRow(p.id)}
                      className={`group text-[13px] text-zinc-300 odd:bg-zinc-900/30 hover:bg-zinc-800/50 ${editingId === p.id ? "" : "cursor-pointer"}`}
                    >
                      {fcols.map((k) => (
                        <Td
                          key={k}
                          onClick={k === "sel" ? (e) => e.stopPropagation() : undefined}
                          style={isPinned(k) ? pinnedStyle(k, 10) : colStyle(k)}
                          className={`${COL_CLASS[k] ?? ""} ${isPinned(k) ? pinnedCls(k, true) : ""}`}
                        >{cellContent(k, p)}</Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      {companyGroup && (
        <CompanyDrawer
          key={selectedJobId}
          c={companyGroup}
          focusId={selectedJobId}
          onClose={closeDrawer}
          onSetStatus={setStatusGuarded}
          onSetInterviewed={setInterviewed}
          onTier={(tier) => setCompanyTier(companyGroup.company, tier)}
          onDesire={(d) => setCompanyDesire(companyGroup.company, d)}
          onToggleWatchlist={(on) => setWatchlist(companyGroup.company, on)}
          onEditField={setField}
          onChanged={reload}
          onMove={moveJob}
          onDelete={(p) => {
            deleteJob(p);
            if (selectedJobId === p.id || companyGroup.items.length === 1) closeDrawer();
          }}
          onRename={(name) => {
            const trimmed = name.trim();
            if (trimmed && trimmed !== companyGroup.company) {
              renameCompany(companyGroup.company, trimmed);
              setSelectedCompany(trimmed); // keep the drawer pointed at the renamed company
            }
          }}
        />
      )}

      {/* Pre-apply (scan-stage) row → same drawer, edits persisted by id via PATCH. */}
      {scanAgg && scanPosting && (
        <CompanyDrawer
          key={scanPosting.id}
          c={scanAgg}
          focusId={scanPosting.id}
          onClose={() => setScanPosting(null)}
          onSetStatus={async (p, status) => {
            const guard = await guardTailoringDrop(String(p.id), p.company, p.role, status);
            if (guard === null) return; // cancelled
            if (status === "applied") {
              const date = await askAppliedDate(p.appliedDate);
              if (date === null) return;
              scanEdit(p.id, { status, appliedDate: date, ...guard });
            } else {
              scanEdit(p.id, { status, ...(status === "interview" && !p.interviewed ? { interviewed: true } : {}), ...guard });
            }
          }}
          onSetInterviewed={(p, on) => scanEdit(p.id, { interviewed: on })}
          onTier={(tier) => scanEdit(scanPosting.id, { tier })}
          onDesire={(d) => setCompanyDesire(scanPosting.company, d)}
          onToggleWatchlist={(on) => { setWatchlist(scanPosting.company, on); setScanPosting((cur) => (cur ? { ...cur, watchlist: on } : cur)); }}
          onEditField={(p, changes) => scanEdit(p.id, changes)}
          onChanged={refreshScan}
          onMove={(p, company) => scanEdit(p.id, { moveToCompany: company })}
          onDelete={async (p) => { await fetch(`/api/applications/${p.id}`, { method: "DELETE" }).catch(() => {}); setScanPosting(null); refreshScan(); }}
          onRename={(name) => { const t = name.trim(); if (t && t !== scanPosting.company) scanEdit(scanPosting.id, { companyName: t }); }}
        />
      )}

      {diffSlug && <ResumeDiffModal key={diffSlug} slug={diffSlug} postingId={diffPostingId ?? undefined} redoNote={diffPostingId ? redoNoteFor(diffPostingId, "tailor") : null} annotated={diffAnnotated} title={diffSlug} onClose={() => { setDiffSlug(null); setDiffPostingId(null); setDiffAnnotated(undefined); }} />}
      {peerOpen && <PeerCompModal onClose={() => setPeerOpen(false)} />}
      {appliedAsk && <AppliedDateModal existing={appliedAsk.existing} onResolve={resolveApplied} />}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          candidate={!isTrackerStep(tab)}
          onClear={clearSel}
          onDiscard={bulkDiscard}
          onAssess={() => bulkHandoff("queue-fit")}
          onTailor={() => bulkHandoff("tailor")}
          onMove={bulkMove}
        />
      )}
      {dropAsk && <DropTailoringModal company={dropAsk.company} role={dropAsk.role} target={dropAsk.target} onResolve={resolveDrop} />}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/95 px-4 py-2 text-[13px] text-zinc-200 shadow-xl backdrop-blur">
            <Info size={14} className="shrink-0 text-sky-300" />
            {toast}
            <button onClick={() => setToast(null)} className="ml-1 shrink-0 text-zinc-500 transition hover:text-zinc-200"><X size={13} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// The 3-way confirm shown when a status move would drop a posting's still-queued résumé-tailoring
// job. Drop (default) removes it; Keep spares it (it outlives the move, but running it later re-marks
// the posting "tailored"); Cancel aborts. Modeled on AppliedDateModal.
function DropTailoringModal({ company, role, target, onResolve }: { company: string; role: string; target: string; onResolve: (v: "drop" | "keep" | "cancel") => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onResolve("cancel"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResolve]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => onResolve("cancel")}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-semibold text-zinc-100">Drop the queued tailoring job?</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">
          <span className="text-zinc-200">{company}</span>{role ? <> — {role}</> : null} has a résumé-tailoring job still
          queued (the agent hasn&apos;t run it). Moving it to <span className="text-zinc-200">{target}</span> can drop that job.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-600">
          Keep it and the job outlives the move — but when the agent runs it, the posting moves back to <span className="text-zinc-400">Tailored</span>.
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button onClick={() => onResolve("cancel")} className="rounded-lg px-3 py-1.5 text-[13px] text-zinc-400 transition hover:text-zinc-200">Cancel</button>
          <button onClick={() => onResolve("keep")} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-[13px] font-medium text-zinc-200 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-700">Keep job &amp; move</button>
          <button onClick={() => onResolve("drop")} className="rounded-lg bg-rose-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-rose-500">Drop &amp; move</button>
        </div>
      </div>
    </div>
  );
}

// Captures the real applied date when a posting is moved to Applied. Two modes: a fresh prompt
// (default today, Cancel aborts the move) and, when a date already exists, an update prompt that
// lets you keep it or change it. Resolves with the chosen date, or null to cancel.
// Floating bulk-action bar (bottom-center) shown while rows are selected. Hand-offs (Assess fit /
// Tailor) only appear for candidate steps; "Move to" opens the same stage list as a row's ⋯ menu.
function BulkBar({ count, candidate, onClear, onDiscard, onAssess, onTailor, onMove }: {
  count: number; candidate: boolean; onClear: () => void; onDiscard: () => void; onAssess: () => void; onTailor: () => void; onMove: (state: string) => void;
}) {
  const [movePos, setMovePos] = useState<{ x: number; y: number } | null>(null);
  return (
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-1.5 rounded-2xl border border-zinc-700 bg-zinc-900/95 px-3 py-2 shadow-2xl shadow-black/50 ring-1 ring-white/5 backdrop-blur">
        <span className="rounded-lg bg-sky-500/15 px-2 py-1 text-[12px] font-semibold tabular-nums text-sky-200">{count} selected</span>
        <span className="mx-0.5 h-5 w-px bg-zinc-700" />
        {candidate && (
          <>
            <BulkBtn tone="sky" icon={Bot} onClick={onAssess}>Assess fit</BulkBtn>
            <BulkBtn tone="sky" icon={Bot} onClick={onTailor}>Tailor</BulkBtn>
          </>
        )}
        <BulkBtn tone="zinc" icon={ArrowRight} onClick={(e) => setMovePos(movePos ? null : anchorFrom(e))}>Move to</BulkBtn>
        {movePos && (
          <PopoverPanel at={movePos} onClose={() => setMovePos(null)} className="p-1">
            <div className="flex flex-col gap-0.5">
              {MOVE_TARGETS.map((t) => (
                <button
                  key={t.state}
                  onClick={() => { onMove(t.state); setMovePos(null); }}
                  className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium text-zinc-300 transition hover:bg-zinc-800"
                >{t.label}</button>
              ))}
            </div>
          </PopoverPanel>
        )}
        <BulkBtn tone="rose" icon={Trash2} onClick={onDiscard}>Discard</BulkBtn>
        <button onClick={onClear} title="Clear selection" className="ml-0.5 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"><X size={15} /></button>
      </div>
    </div>
  );
}

function BulkBtn({ tone, icon: Icon, onClick, children }: { tone: "sky" | "rose" | "zinc"; icon: typeof Bot; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  const cls = tone === "sky" ? "text-sky-200 hover:bg-sky-500/15" : tone === "rose" ? "text-rose-200 hover:bg-rose-500/15" : "text-zinc-200 hover:bg-zinc-800";
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition ${cls}`}>
      <Icon size={13} />{children}
    </button>
  );
}

function AppliedDateModal({ existing, onResolve }: { existing?: string; onResolve: (d: string | null) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(existing || today);
  const isUpdate = !!existing;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onResolve(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResolve]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => onResolve(null)}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-semibold text-zinc-100">{isUpdate ? "Update applied date?" : "When did you apply?"}</h3>
        <p className="mt-1 text-[12px] text-zinc-500">
          {isUpdate ? <>Already marked applied on <span className="tabular-nums text-zinc-300">{existing}</span>. Change the date, or keep it.</> : "Set the date this application was submitted."}
        </p>
        <input
          type="date"
          value={date}
          max={today}
          autoFocus
          onChange={(e) => setDate(e.target.value)}
          className="mt-3 w-full rounded-lg bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 outline-none ring-1 ring-inset ring-zinc-800 [color-scheme:dark] focus:ring-sky-500/40"
        />
        <div className="mt-4 flex justify-end gap-2">
          {isUpdate ? (
            <button onClick={() => onResolve(existing!)} className="rounded-lg px-3 py-1.5 text-[13px] text-zinc-400 transition hover:text-zinc-200">Keep {existing}</button>
          ) : (
            <button onClick={() => onResolve(null)} className="rounded-lg px-3 py-1.5 text-[13px] text-zinc-400 transition hover:text-zinc-200">Cancel</button>
          )}
          <button
            onClick={() => date && onResolve(date)}
            disabled={!date}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
          >
            {isUpdate ? "Update" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// One segment of the spine ribbon — a right-pointing arrow (clip-path) that interlocks with its
// neighbours. Filled when active, faint tint otherwise. Scaled up so the spine reads as the page's
// primary navigation.
// `muted` = a filter is active and this stage has 0 matches (dim it); `hit` = filter active and this
// stage HAS matches (glow amber) — together the ribbon reads as a "where is this company?" heatmap.
function ArrowStep({ step, count, active, first, muted, hit, onClick }: { step: SpineStep; count?: number; active: boolean; first: boolean; muted?: boolean; hit?: boolean; onClick: () => void }) {
  const A = 14; // arrow depth, px
  const clip = first
    ? `polygon(0 0, calc(100% - ${A}px) 0, 100% 50%, calc(100% - ${A}px) 100%, 0 100%)`
    : `polygon(0 0, calc(100% - ${A}px) 0, 100% 50%, calc(100% - ${A}px) 100%, 0 100%, ${A}px 50%)`;
  const tone = active
    ? "bg-violet-500 text-violet-50 shadow-sm"
    : hit
    ? "bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
    : "bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 hover:text-violet-200 [.light_&]:hover:text-violet-700";
  const badge = active ? "bg-violet-50/25 text-violet-50" : hit ? "bg-amber-500/25 text-amber-100" : "bg-violet-500/20 text-violet-300";
  return (
    <div style={{ marginLeft: first ? 0 : -(A - 2) }} className="flex shrink-0">
      <button
        onClick={onClick}
        title={step.hint}
        style={{ clipPath: clip }}
        className={`relative flex items-center gap-2 py-2.5 pr-5 text-[14px] font-semibold transition ${first ? "pl-4" : "pl-7"} ${tone} ${muted ? "opacity-40" : ""}`}
      >
        {step.label}
        {count != null && (
          <span className={`rounded-full px-1.5 text-[12px] font-bold tabular-nums ${badge}`}>{count}</span>
        )}
      </button>
    </div>
  );
}

// A pill step button (the archive row); the count badge inverts when active.
function StepBtn({ step, count, active, onClick }: { step: SpineStep; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={step.hint}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium ring-1 ring-inset transition ${
        active ? "bg-zinc-200 text-zinc-900 ring-transparent" : "text-zinc-400 ring-zinc-800 hover:bg-zinc-800/60"
      }`}
    >
      {step.label}
      {count != null && <span className={`rounded-full px-1 text-[11px] tabular-nums ${active ? "bg-zinc-400 text-zinc-700" : "bg-zinc-800 text-zinc-500"}`}>{count}</span>}
    </button>
  );
}

// Sub-filter for the Closed step: which outcome, and whether you actually interviewed. Two
// independent axes that COMBINE — "Rejected + Interviewed" answers "who turned me down after a real
// loop?", which the outcome pills alone can't. Counts are faceted (see closedFilterCounts): each
// pill promises what clicking it would actually give you, holding the other axis where it is.
function ClosedFilter({ present, base, active, onChange }: { present: Status[]; base: Posting[]; active: ClosedFilterState; onChange: (f: ClosedFilterState) => void }) {
  const counts = closedFilterCounts(base, active);
  const chipCls = (on: boolean) =>
    `flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${
      on ? "border-transparent bg-zinc-100 text-zinc-900" : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
    }`;
  const chip = (key: Status | "all", label: string, n: number) => {
    const on = active.status === key;
    return (
      <button key={key} onClick={() => onChange({ ...active, status: key })} className={chipCls(on)}>
        {label}
        <span className={`tabular-nums ${on ? "text-zinc-500" : "text-zinc-600"}`}>{n}</span>
      </button>
    );
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      {chip("all", "all", counts.all)}
      {present.map((s) => chip(s, STATUS_LABEL[s], counts.byStatus[s] ?? 0))}
      {counts.interviewed > 0 && (
        <>
          <span className="mx-1 h-4 w-px bg-zinc-800" aria-hidden />
          <button
            onClick={() => onChange({ ...active, interviewed: !active.interviewed })}
            title="Only postings that reached the interview stage — including ones that got no further than a recruiter screen"
            className={chipCls(active.interviewed)}
          >
            <UserCheck size={12} /> Interviewed
            <span className={`tabular-nums ${active.interviewed ? "text-zinc-500" : "text-zinc-600"}`}>{counts.interviewed}</span>
          </button>
        </>
      )}
    </div>
  );
}

function Title({ text, url, hint }: { text: string; url?: string | null; hint?: string }) {
  const [preview, setPreview] = useState(false);
  // Break the title onto a new line after each comma (e.g. "Senior Software Engineer, Gemini").
  const parts = text.split(",");
  const body = parts.map((part, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {part.trim()}{i < parts.length - 1 ? "," : ""}
    </span>
  ));
  return (
    <span title={hint}>
      {/* Clicking the title opens the in-app iframe preview. stopPropagation so it doesn't also
          fire the row's drawer click. No URL → plain text. */}
      {url ? (
        <button
          onClick={(e) => { e.stopPropagation(); setPreview(true); }}
          title="Preview posting"
          className="text-left text-zinc-100 transition hover:text-sky-300 hover:underline"
        >
          {body}
        </button>
      ) : (
        <span className="text-zinc-100">{body}</span>
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Open in new tab"
          className="ml-1.5 inline text-zinc-600 hover:text-sky-400"
        >
          <ExternalLink size={11} className="inline" />
        </a>
      )}
      {preview && url && <LinkPreview url={url} title={text} onClose={() => setPreview(false)} />}
    </span>
  );
}

// In-app preview of a job posting — an iframe modal so you can skim without leaving the funnel.
// Many ATS/job boards forbid framing (X-Frame-Options / frame-ancestors). A blocked frame still
// fires `load`, so we can't detect it client-side — instead we probe the headers server-side
// (/api/embeddable) and, when embedding is blocked, show an "open in new tab" fallback.
function LinkPreview({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const [embeddable, setEmbeddable] = useState<boolean | null>(null); // null = still checking

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/embeddable?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setEmbeddable(Boolean(d.embeddable)); })
      .catch(() => { if (alive) setEmbeddable(false); });
    return () => { alive = false; };
  }, [url]);

  // Portal to <body>: this modal is rendered deep inside a FROZEN (position:sticky, z-index:10) table
  // cell, which is its own stacking context — so the modal's z-[60] would only compete *within* that
  // cell and the sticky spine (z-30, root context) paints over it. Portaling escapes to the root
  // stacking context where z-[60] wins over all the page chrome.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
          <span className="flex-1 truncate text-[13px] font-medium text-zinc-200">{title}</span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-[12px] text-zinc-400 transition hover:text-sky-300"
          >
            <ExternalLink size={12} /> Open in new tab
          </a>
          <button onClick={onClose} title="Close (Esc)" className="shrink-0 text-zinc-500 transition hover:text-zinc-200"><X size={16} /></button>
        </div>
        {embeddable === null ? (
          <div className="flex flex-1 items-center justify-center gap-2 bg-zinc-900 text-sm text-zinc-500">
            <Loader2 size={16} className="animate-spin" /> loading…
          </div>
        ) : embeddable ? (
          <iframe src={url} title={title} className="w-full flex-1 bg-white" />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-900 px-6 text-center">
            <p className="max-w-sm text-[13px] leading-relaxed text-zinc-400">
              This site blocks embedding, so the posting can’t be previewed here. Open it in a new tab to view the full listing.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-violet-500 px-3 py-1.5 text-[13px] font-medium text-violet-50 transition hover:bg-violet-400"
            >
              <ExternalLink size={14} /> Open in new tab
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Btn({ tone, onClick, title, children }: { tone: "emerald" | "rose" | "sky" | "amber"; onClick: () => void; title: string; children: React.ReactNode }) {
  const cls = tone === "emerald" ? "text-emerald-300 ring-emerald-500/30 hover:bg-emerald-500/15"
    : tone === "sky" ? "text-sky-300 ring-sky-500/30 hover:bg-sky-500/15"
    : tone === "amber" ? "text-amber-300 ring-amber-500/30 hover:bg-amber-500/15"
    : "text-rose-300 ring-rose-500/30 hover:bg-rose-500/15";
  return (
    <button onClick={onClick} title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[13px] font-medium ring-1 ring-inset transition ${cls}`}>
      {children}
    </button>
  );
}

// Row actions: the first (primary) as a quick button, the rest behind a ⋯ menu so the column
// stays uncrowded. A single-action row shows just the button; no actions → nothing.
// The comment cell: a MessageSquare icon (+ count when there are comments) that opens a portaled
// popover with the thread + an input to add. Comments persist via /api/applications/:id/comment;
// `onChanged` refreshes the row so the count updates.
// Renders **bold** spans inside otherwise-plain comment text.
function renderBold(text: string) {
  return text.split(/(\*\*[^*]+?\*\*)/g).map((part, i) => {
    const m = part.match(/^\*\*([^*]+?)\*\*$/);
    return m ? <strong key={i} className="font-semibold text-zinc-100">{m[1]}</strong> : <span key={i}>{part}</span>;
  });
}

function CommentCell({ id, comments, onChanged }: { id: number; comments: Comment[]; onChanged: () => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [list, setList] = useState<Comment[]>(comments);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | null>(null); // index being edited, or null = adding new
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Seeded once from props; thereafter local is the source of truth (the cell is keyed by posting id
  // at the row level, and add/delete update `list` from the API response — so no prop-resync needed).

  // Auto-grow the textarea to fit its content (capped), so the box expands as you type.
  const autosize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  useEffect(autosize, [draft]);

  const send = async (method: "POST" | "PATCH" | "DELETE", body: object) => {
    setBusy(true);
    const r = await fetch(`/api/applications/${id}/comment`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (r?.ok) {
      const d = await r.json(); setList(d.posting?.comments ?? []); onChanged();
      if (method === "POST") {
        pendo.track("comment_added", {
          posting_id: id,
          comment_length: (body as { text?: string }).text?.length,
        });
      }
    }
    setBusy(false);
  };
  // Submit the draft: PATCH when editing an existing comment, otherwise POST a new one.
  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    if (editing !== null) send("PATCH", { index: editing, text: t });
    else send("POST", { text: t });
    setDraft(""); setEditing(null);
  };
  const startEdit = (i: number) => {
    setEditing(i); setDraft(list[i].text);
    requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } });
  };
  const cancelEdit = () => { setEditing(null); setDraft(""); };
  const n = list.length;

  // Replaces a leading "-"/"*" on the current line with a "• " bullet. Returns true if it converted.
  const dashToBullet = (el: HTMLTextAreaElement) => {
    const start = el.selectionStart;
    if (start !== el.selectionEnd) return false;
    const lineStart = draft.lastIndexOf("\n", start - 1) + 1;
    const m = draft.slice(lineStart, start).match(/^(\s*)[-*]$/);
    if (!m) return false;
    const next = `${draft.slice(0, lineStart)}${m[1]}• ${draft.slice(start)}`;
    const caret = lineStart + m[1].length + 2;
    setDraft(next);
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = caret; });
    return true;
  };

  // Indents (Tab) or outdents (Shift+Tab) the bullet line under the cursor by two spaces.
  const indentBullet = (el: HTMLTextAreaElement, out: boolean) => {
    const start = el.selectionStart;
    const lineStart = draft.lastIndexOf("\n", start - 1) + 1;
    const line = draft.slice(lineStart).split("\n", 1)[0];
    if (!/^\s*[-*•]\s/.test(line)) return false;
    let next: string, caret: number;
    if (out) {
      const drop = line.match(/^ {1,4}/)?.[0].length ?? 0;
      if (!drop) return true; // already flush; swallow Tab anyway
      next = draft.slice(0, lineStart) + draft.slice(lineStart + drop);
      caret = Math.max(lineStart, start - drop);
    } else {
      next = `${draft.slice(0, lineStart)}    ${draft.slice(lineStart)}`;
      caret = start + 4;
    }
    setDraft(next);
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = caret; });
    return true;
  };

  // Key handling for the draft box: Enter submits; Shift+Enter inserts a newline, but on a bullet line
  // it continues the list (and an empty bullet ends it). A leading "-"/"*" + space becomes a "• " bullet;
  // Tab on a bullet line indents it (Shift+Tab outdents) — editor-style markdown bullets.
  // Wraps the current selection in ** ** (or unwraps it if already bold). Toolbar button + ⌘/Ctrl+B.
  const toggleBold = () => {
    const el = taRef.current;
    if (!el) return;
    const s = el.selectionStart, en = el.selectionEnd;
    const sel = draft.slice(s, en);
    let next: string, a: number, b: number;
    if (sel.startsWith("**") && sel.endsWith("**") && sel.length > 4) {
      next = draft.slice(0, s) + sel.slice(2, -2) + draft.slice(en); a = s; b = en - 4;
    } else {
      next = `${draft.slice(0, s)}**${sel}**${draft.slice(en)}`; a = s + 2; b = en + 2;
    }
    setDraft(next);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = a; el.selectionEnd = b; });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) { e.preventDefault(); toggleBold(); return; }
    if (e.key === " " && dashToBullet(e.currentTarget)) { e.preventDefault(); return; }
    if (e.key === "Tab") {
      const el = e.currentTarget;
      if (dashToBullet(el) || indentBullet(el, e.shiftKey)) e.preventDefault();
      return;
    }
    if (e.key !== "Enter") return;
    if (!e.shiftKey) { e.preventDefault(); submit(); return; }
    const el = e.currentTarget;
    const start = el.selectionStart, end = el.selectionEnd;
    const lineStart = draft.lastIndexOf("\n", start - 1) + 1;
    const line = draft.slice(lineStart, start);
    const m = line.match(/^(\s*)([-*•])\s+/);
    if (!m) return; // default: plain newline
    e.preventDefault();
    let next: string, caret: number;
    if (line.trim() === m[2]) {
      // empty bullet → end the list by clearing this line
      next = draft.slice(0, lineStart) + draft.slice(end);
      caret = lineStart;
    } else {
      const insert = `\n${m[1]}${m[2]} `;
      next = draft.slice(0, start) + insert + draft.slice(end);
      caret = start + insert.length;
    }
    setDraft(next);
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = caret; });
  };

  // Starts a bullet line (or prefixes the current line) when the user clicks the bullet button.
  const addBullet = () => {
    const el = taRef.current;
    const at = el ? el.selectionStart : draft.length;
    const lineStart = draft.lastIndexOf("\n", at - 1) + 1;
    const atLineStart = at === lineStart;
    const needsBreak = lineStart > 0 && !atLineStart;
    const insert = `${needsBreak ? "\n" : ""}• `;
    const next = draft.slice(0, at) + insert + draft.slice(at);
    setDraft(next);
    const caret = at + insert.length;
    requestAnimationFrame(() => { if (taRef.current) { taRef.current.focus(); taRef.current.selectionStart = taRef.current.selectionEnd = caret; } });
  };

  // The comment editor — reused for BOTH adding (bottom) and editing IN PLACE (inside a comment's own
  // box). Only one is mounted at a time (editing is exclusive with adding), so they can share `draft`.
  const editorBox = (mode: "add" | "edit") => (
    <div className="overflow-hidden rounded-md bg-zinc-800 ring-1 ring-inset ring-zinc-700 transition focus-within:ring-zinc-500">
      <textarea
        ref={taRef} autoFocus rows={mode === "edit" ? 2 : 1} value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        placeholder={mode === "edit" ? "Edit comment…" : "Add a comment…"}
        className="block max-h-40 w-full resize-none bg-transparent px-2.5 py-2 text-[13px] leading-snug text-zinc-200 outline-none placeholder:text-zinc-600"
      />
      <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
        <div className="flex items-center gap-0.5">
          <button onClick={addBullet} title="Bullet list" className="rounded p-1 text-zinc-500 transition hover:bg-zinc-700 hover:text-zinc-200"><List size={14} /></button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={toggleBold} title="Bold (⌘B)" className="rounded p-1 text-zinc-500 transition hover:bg-zinc-700 hover:text-zinc-200"><Bold size={14} /></button>
        </div>
        <div className="flex items-center gap-1.5">
          {mode === "edit" && <button onClick={cancelEdit} disabled={busy} className="rounded px-2 py-1 text-[12px] font-medium text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-40">Cancel</button>}
          <button onClick={submit} disabled={busy || !draft.trim()} className="rounded bg-violet-500 px-2.5 py-1 text-[12px] font-medium text-violet-50 transition enabled:hover:bg-violet-400 disabled:opacity-40">{mode === "edit" ? "Save" : "Add"}</button>
        </div>
      </div>
    </div>
  );

  return (
    <span className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={(e) => { e.stopPropagation(); setPos(pos ? null : anchorFrom(e)); }}
        title={n ? `${n} comment${n === 1 ? "" : "s"}` : "Add a comment"}
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] transition ${n ? "text-amber-300 hover:text-amber-200" : "text-zinc-600 hover:text-zinc-300"}`}
      >
        <MessageSquare size={13} className={n ? "fill-amber-300/15" : ""} />
        {n > 0 && <span className="font-medium tabular-nums">{n}</span>}
      </button>
      {pos && (
        <PopoverPanel at={pos} onClose={() => setPos(null)} className="w-[32rem] p-2">
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {list.length === 0 && <p className="px-1 py-2 text-center text-[12px] text-zinc-600">No comments yet.</p>}
            {list.map((c, i) => (
              <div key={i} className={`group rounded-md px-2 py-1.5 transition ${editing === i ? "bg-violet-500/10 ring-1 ring-inset ring-violet-500/40" : "bg-zinc-800/50"}`}>
                {editing === i ? (
                  // Edit IN PLACE — the comment's own box becomes the editor (same rich box as adding).
                  editorBox("edit")
                ) : (
                  <>
                    <div className="flex items-start gap-2">
                      <p className="flex-1 whitespace-pre-wrap break-words text-[13px] text-zinc-200">{renderBold(c.text)}</p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button onClick={() => startEdit(i)} disabled={busy} title="Edit" className="text-zinc-500 transition hover:text-zinc-200 disabled:opacity-40"><Pencil size={12} /></button>
                        <button onClick={() => send("DELETE", { index: i })} disabled={busy} title="Delete" className="text-zinc-500 transition hover:text-rose-300 disabled:opacity-40"><Trash2 size={12} /></button>
                      </div>
                    </div>
                    <p className="mt-0.5 text-[11px] text-zinc-500">{ago(c.at)}{c.editedAt ? " · edited" : ""}</p>
                  </>
                )}
              </div>
            ))}
          </div>
          {/* The add box lives at the bottom — hidden while editing a comment inline (one editor at a time). */}
          {editing === null && (
            <div className="mt-1.5 border-t border-zinc-800 pt-1.5">
              {editorBox("add")}
            </div>
          )}
        </PopoverPanel>
      )}
    </span>
  );
}

function ActionCell({ actions, state, fitDone, resumeDone, onAct, onMove, onEdit }: { actions: ActionKey[]; state: string; fitDone?: boolean; resumeDone?: boolean; onAct: (a: ActionKey, queueOnly?: boolean) => void; onMove: (state: string) => void; onEdit: () => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  // Just the PRIMARY action as a quick button; every secondary action folds into the ⋯ menu, which
  // also carries "Move to" (jump to any stage out of sequence). The ⋯ shows on every row — even
  // tracker rows with no contextual quick action.
  // Exception: in the FIT stage triage is the whole job (queue vs. drop), so Discard rides along as a
  // second quick button — dropping a match is one click instead of a dig through the ⋯ menu. The
  // action column is icon-only and pinned to the right edge (RIGHT_W.act); the wrapper flex-wraps as
  // a backstop if a row ever carries more than a couple of quick actions.
  // Only Discard is a one-click quick action now; every other action lives in the ⋯ menu, and bulk
  // selection handles the rest across many rows at once.
  const inline = actions.includes("discard") ? (["discard"] as ActionKey[]) : [];
  // Queue hand-offs get their own section, so keep them out of the generic secondary list.
  const more = actions.filter((a) => !inline.includes(a) && !QUEUE_KEYS.includes(a));
  // On candidate rows, offer both queue hand-offs — minus whichever is already the inline quick button.
  const queueItems = CANDIDATE_STATES.has(state) ? QUEUE_ACTIONS.filter((q) => !inline.includes(q.key)) : [];
  const moves = MOVE_TARGETS.filter((t) => t.stage !== STATE_STAGE[state]);
  // The ⋯ menu always shows now: it carries Edit at minimum (plus any secondary actions / Move to).
  const hasMenu = true;
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      {inline.map((a) => {
        const m = ACTION_META[a];
        const I = m.icon;
        // Icon-only (label is the tooltip) so the column stays compact enough to pin to the right edge.
        return (
          <Btn key={a} tone={m.tone} onClick={() => onAct(a)} title={m.title}>{I ? <I size={14} /> : m.label}</Btn>
        );
      })}
      {hasMenu && (
        <button
          onClick={(e) => { e.stopPropagation(); setPos(pos ? null : anchorFrom(e)); }}
          title="More actions — including move to any stage"
          className="rounded-md p-1 text-zinc-500 ring-1 ring-inset ring-zinc-800 transition hover:bg-zinc-800 hover:text-zinc-200"
        >
          <MoreHorizontal size={14} />
        </button>
      )}
      {pos && (
        <PopoverPanel at={pos} onClose={() => setPos(null)} className="p-1">
          <div className="flex flex-col gap-0.5">
            <button
              onClick={() => { onEdit(); setPos(null); }}
              title="Edit company / title / location"
              className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium text-zinc-300 transition hover:bg-zinc-800"
            >
              <Pencil size={13} className="text-zinc-500" />Edit
            </button>
            {(more.length > 0 || queueItems.length > 0 || moves.length > 0) && <div className="my-0.5 border-t border-zinc-800" />}
            {more.map((a) => {
              const m = ACTION_META[a];
              const I = m.icon;
              return (
                <button
                  key={a}
                  onClick={() => { onAct(a); setPos(null); }}
                  title={m.title}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium transition hover:bg-zinc-800 ${TONE_TEXT[m.tone]}`}
                >
                  {I && <I size={13} />}{m.label}{m.arrow && <ArrowRight size={13} className="ml-auto" />}
                </button>
              );
            })}
            {more.length > 0 && queueItems.length > 0 && <div className="my-0.5 border-t border-zinc-800" />}
            {queueItems.length > 0 && (
              <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">Queue</div>
            )}
            {queueItems.map((q) => {
              // Already have the artifact? It's a re-run, so label it "Redo …".
              const done = q.key === "queue-fit" ? fitDone : resumeDone;
              const label = done ? `Redo ${q.label.toLowerCase()}` : q.label;
              return (
                <button
                  key={q.key}
                  onClick={() => { onAct(q.key, true); setPos(null); }}
                  title={`Hand off to the agent — ${label.toLowerCase()} (doesn't change the stage)`}
                  className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium text-sky-300 transition hover:bg-zinc-800"
                >
                  <Bot size={13} />{label}<ArrowRight size={13} className="ml-auto text-zinc-500" />
                </button>
              );
            })}
            {(more.length > 0 || queueItems.length > 0) && moves.length > 0 && <div className="my-0.5 border-t border-zinc-800" />}
            {moves.length > 0 && (
              <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">Move to</div>
            )}
            {moves.map((t) => (
              <button
                key={t.state}
                onClick={() => { onMove(t.state); setPos(null); }}
                title={`Move to ${t.label}`}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium text-zinc-300 transition hover:bg-zinc-800"
              >
                <ChevronRight size={13} className="text-zinc-500" />{t.label}
              </button>
            ))}
          </div>
        </PopoverPanel>
      )}
    </span>
  );
}

// A quiet "waiting on the agent" status. How to actually run the queue lives once in the floating
// queue panel (its command center), so the rows stay uncluttered.
// "NEW" — a row that entered its current stage within the last day (see isNewRow). Draws the eye to
// what the agent just added to this stage; the row also floats to the top and carries a faint tint.
function NewTag() {
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300" title="Added to this stage in the last day">
      New
    </span>
  );
}

function Td({ children, className, style, onClick }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties; onClick?: (e: React.MouseEvent) => void }) {
  return <td onClick={onClick} style={style} className={`border-b border-zinc-900 px-2.5 py-2.5 align-top first:pl-0 ${className ?? ""}`}>{children}</td>;
}
