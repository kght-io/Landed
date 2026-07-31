import { Loader2, RefreshCw, RotateCw } from "lucide-react";

// The four standard working states a job/posting can be in. ONE source of truth for the status
// pill — used wherever a status is shown (funnel table cells, the floating queue, the Agents page)
// so they never drift.
export type WorkStatus = "in_progress" | "queued_redo" | "queued_tailor" | "queued_fit";

// Queued states share one soft amber tone and read with just TWO labels — plain "Queued" for any
// pending work (fit, tailoring, …) and "Queued for redo" for a redo — so the status text stays short
// and uniform. A still (non-spinning) circular arrow marks queued work; only the active "In progress"
// state is distinct (sky + spinning loader). Uses `amber-300` (NOT `yellow-300`) because amber is in
// the light-theme remap (globals.css), so it auto-darkens on light backgrounds — readable in both
// themes while staying light/soft (matches the fit-gap chips).
const QUEUED = "text-amber-300 bg-amber-500/15";
const STATUS_META: Record<WorkStatus, { icon: typeof Loader2; label: string; cls: string; spin?: boolean }> = {
  in_progress:   { icon: Loader2,   label: "In progress",     cls: "text-sky-300 bg-sky-500/15", spin: true },
  queued_redo:   { icon: RefreshCw, label: "Queued for redo", cls: QUEUED },
  queued_tailor: { icon: RotateCw,  label: "Queued",          cls: QUEUED },
  queued_fit:    { icon: RotateCw,  label: "Queued",          cls: QUEUED },
};

// The standard status pill. `compact` drops the label (icon only) for tight cells.
export function JobStatusChip({ status, compact }: { status: WorkStatus; compact?: boolean }) {
  const m = STATUS_META[status];
  const I = m.icon;
  return (
    <span title={m.label} className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${m.cls}`}>
      <I size={11} className={m.spin ? "animate-spin" : ""} />
      {!compact && m.label}
    </span>
  );
}

// Derive the standard status from a live queue job: `wip` → in progress; a queued job carrying a
// redo note → redo; else by type. Returns null for job types outside the four standard states
// (inbox-sync, watchlist-scan, …) — those rely on their verb tab in the queue UI.
export function jobWorkStatus(job: { status: string; type: string; params?: Record<string, unknown> }): WorkStatus | null {
  if (job.status === "wip") return "in_progress";
  const redoNote = job.params?.redoNote;
  if (typeof redoNote === "string" && redoNote.trim().length > 0) return "queued_redo";
  if (job.type === "tailoring") return "queued_tailor";
  if (job.type === "fit") return "queued_fit";
  return null;
}
