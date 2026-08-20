"use client";

import { useState } from "react";
import { Building2, X, ExternalLink, Link2, Trash2, Radar, GitCompareArrows, MapPin, CalendarClock, RefreshCw, Pencil, FileText } from "lucide-react";
import type { InterviewRound, Posting, RedoTurn, Status, Tier } from "@landed/shared/types";
import { reapplyInfo, STATUS_LABEL, STATUS_CHIP, TIER_META, TIERS } from "@landed/shared/pipeline/stages";
import { isCooling } from "@landed/shared/pipeline/cooldown";
import { ROUND_KIND_LABEL } from "@landed/shared/pipeline/interview-loop";
import { type CompanyAgg } from "@landed/shared/pipeline/board";
import InterviewStages from "./InterviewStages";
import CoolingBadge from "./CoolingBadge";
import PrepChatCard from "./PrepChatCard";
import PrepMaterials from "./PrepMaterials";
import InterviewBriefCard from "./InterviewBriefCard";
import { SectionLabel, EDIT_BASE } from "./ui";
import { useAgentQueue } from "@/components/AgentQueueProvider";
import { baseResumeUrl } from "@/lib/local-capability";
import { tailorDiffFor } from "@landed/shared/jobs/redolog";
import { FitBadge, GapList } from "./Badges";
import ResumeDiffModal from "@/components/ResumeDiff";
import FitDetailModal from "@/components/FitDetail";
import { DesireSelect } from "@/components/DesireTag";
import { usePersistentState } from "@/hooks/usePersistentState";

// Header chip on a tailored/assessed section with a redo in flight (the stage doesn't regress).
function RedoChip() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 align-middle text-[10px] font-medium text-violet-300">
      <RefreshCw size={9} /> Queued for redo
    </span>
  );
}

// The review decision on an assessed posting → a stage move. The option matching the agent's
// recommendation is highlighted.
function DecisionButtons({ p, onSetStatus }: { p: Posting; onSetStatus: (p: Posting, s: Status) => void }) {
  const rec = p.fit?.recommendation?.toLowerCase();
  const opts: { label: string; to: Status; on: boolean; onCls: string }[] = [
    { label: "Apply", to: "applied", on: rec === "apply", onCls: "bg-emerald-500 text-emerald-950 hover:bg-emerald-400" },
    { label: "→ Tailoring", to: "tailoring", on: rec === "tailor", onCls: "bg-sky-500 text-sky-950 hover:bg-sky-400" },
    { label: "Discard", to: "company_skipped", on: rec === "skip", onCls: "bg-zinc-300 text-zinc-900 hover:bg-zinc-200" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {opts.map((o) => (
        <button
          key={o.to}
          onClick={() => onSetStatus(p, o.to)}
          title={o.on ? "the agent's recommendation" : undefined}
          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[13px] font-medium transition ${
            o.on ? o.onCls : "bg-zinc-800 text-zinc-300 ring-1 ring-inset ring-zinc-700 hover:bg-zinc-700"
          }`}
        >
          {o.on && <span className="text-[11px]">★</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Inline-editable text. Uncontrolled; commits on blur or Enter, reverts on Escape.
function EditField({
  value, onCommit, placeholder, className,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => { if (e.target.value !== value) onCommit(e.target.value); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { (e.target as HTMLInputElement).value = value; (e.target as HTMLInputElement).blur(); }
      }}
      className={`${EDIT_BASE} ${className ?? ""}`}
    />
  );
}


// Placeholder when a reached stage has no artifact (e.g. applied without a fit assessment).
function EmptyStage({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-5 text-center text-[13px] text-zinc-600">{children}</p>;
}


// The interview stage's three panes — where the loop stands (rounds + the brief), the prep coach,
// and the materials that feed both. Tabs rather than a stack: each pane is tall (the chat
// especially), and stacking them buried the one you came for. The choice persists, so the drawer
// reopens where you left it.
const INTERVIEW_TABS = [
  { key: "overview", label: "Overview" },
  { key: "chat", label: "Prep chat" },
  { key: "materials", label: "Materials" },
] as const;

// The tab bar itself lives in the drawer HEADER, not in the scrolling body: it has to stay put while
// a long pane scrolls under it, and `sticky` inside the body's p-5 leaves a strip of that padding
// above the bar for content to scroll through. Sitting in the fixed header, it simply never moves.
// `-mb-5` drops it onto the header's own bottom border, which doubles as the tab underline.
function InterviewTabBar({ active, onChange }: { active: string; onChange: (key: string) => void }) {
  return (
    <div className="-mx-5 -mb-5 mt-4 flex gap-1 px-5">
      {INTERVIEW_TABS.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`-mb-px whitespace-nowrap rounded-t-md border-b-2 px-4 py-2.5 text-[14px] font-semibold tracking-tight transition ${
              on
                ? "border-violet-400 bg-violet-500/10 text-violet-100"
                : "border-transparent text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// The selected pane's content, in the scrolling body.
function InterviewPane({
  active, p, rounds, reapply, onChanged, onSetInterviewed,
}: {
  active: string;
  p: Posting;
  rounds: InterviewRound[];
  reapply: ReturnType<typeof reapplyInfo>;
  onChanged?: () => void;
  onSetInterviewed: (p: Posting, v: boolean) => void;
}) {
  if (active === "chat") return <PrepChatCard p={p} />;
  if (active === "materials") return <PrepMaterials p={p} onChanged={onChanged} />;
  return (
    <div className="space-y-4">
      <StageHighlight p={p} col="interviewing" rounds={rounds} reapply={reapply} />
      <InterviewBriefCard p={p} onChanged={onChanged} />
      <InterviewedToggle p={p} onSetInterviewed={onSetInterviewed} />
    </div>
  );
}

// The fit assessment block — a COMPACT preview (summary + gaps). Click it to open the full detail
// modal (level call, strengths, detailed gaps, history) where the redo composer lives. Decision
// buttons stay here for one-click triage of an assessed posting.
function FitSection({ p, onSetStatus, onOpenDetail }: { p: Posting; onSetStatus?: (p: Posting, s: Status) => void; onOpenDetail: () => void }) {
  const { redoNoteFor } = useAgentQueue();
  if (!p.fit && p.fitScore == null) return null;
  return (
    <div>
      <SectionLabel>Fit{p.fitScore != null && <span className="ml-2 align-middle"><FitBadge score={p.fitScore} /></span>}{redoNoteFor(p.id, "fit") !== null && <RedoChip />}</SectionLabel>
      <button
        onClick={onOpenDetail}
        title="Open the full assessment (level, strengths, gaps) + redo"
        className="block w-full rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-left transition hover:border-violet-500/40 hover:bg-violet-500/[0.04]"
      >
        {p.fit?.summary
          ? <p className="text-[13px] leading-relaxed text-zinc-300">{p.fit.summary}</p>
          : <p className="text-[13px] text-zinc-400">View the fit assessment</p>}
        {!!p.fit?.gaps?.length && <div className="mt-2"><GapList gaps={p.fit.gaps} /></div>}
        <span className="mt-2 inline-block text-[12px] font-medium text-violet-300">view detail →</span>
      </button>
      {p.status === "assessed" && onSetStatus && <div className="mt-2.5"><DecisionButtons p={p} onSetStatus={onSetStatus} /></div>}
    </div>
  );
}

// One tailored version — just its number + a diff for that version. The per-version "what changed"
// summary is intentionally NOT shown (too long; the per-line diff comments carry the detail).
// "used for application" — a checkbox marking which résumé you'll submit (base or one version). Only
// one is chosen at a time, so checking one clears the others (the choice is a single value upstream).
function UsedForApp({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px]" title="Mark this as the résumé you'll submit">
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-800 accent-emerald-500" />
      <span className={checked ? "font-medium text-emerald-300" : "text-zinc-400"}>used for application</span>
    </label>
  );
}

// "interviewed" — reached an interview. Drives the reapply cooldown after a rejection, so it's
// worth being able to set by hand (inbox-sync also sets it, but not every loop is emailed).
function InterviewedToggle({ p, onSetInterviewed }: { p: Posting; onSetInterviewed: (p: Posting, v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[13px]" title="Reached an interview — drives the reapply cooldown after a rejection">
      <input type="checkbox" checked={!!p.interviewed} onChange={(e) => onSetInterviewed(p, e.target.checked)} className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-800 accent-emerald-500" />
      <span className={p.interviewed ? "font-medium text-emerald-300" : "text-zinc-400"}>interviewed</span>
    </label>
  );
}

// The base (untailored) résumé — its own section, with a link to the PDF and the "used for
// application" checkbox (you might submit the base over any tailored version).
function BaseResumeSection({ chosen, onChoose }: { chosen: string | null; onChoose: (v: string | null) => void }) {
  const active = chosen === "base";
  return (
    <div>
      <SectionLabel>Base résumé</SectionLabel>
      <div className={`rounded-lg border p-2.5 ${active ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-zinc-800 bg-zinc-900/40"}`}>
        <div className="flex items-center gap-3">
          <a href={baseResumeUrl()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-sky-300 transition hover:text-sky-200">
            <FileText size={14} className="shrink-0" /> base résumé PDF <ExternalLink size={11} className="shrink-0" />
          </a>
          <span className="ml-auto shrink-0"><UsedForApp checked={active} onToggle={() => onChoose(active ? null : "base")} /></span>
        </div>
      </div>
    </div>
  );
}

function TailorVersion({ t, active, edited, onDiff, onChoose, onToggleEdited }: { t: RedoTurn; active: boolean; edited: boolean; onDiff: (slug: string) => void; onChoose: (v: string | null) => void; onToggleEdited: (slug: string) => void }) {
  return (
    <div className={`rounded-lg border p-2.5 ${active ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-zinc-800 bg-zinc-900/40"}`}>
      <div className="flex items-center gap-2">
        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-sky-300">v{t.version}</span>
        {edited && (
          <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300" title="You manually edited this version's file by hand">
            <Pencil size={10} /> edited
          </span>
        )}
        {t.slug && (
          <button onClick={() => onDiff(t.slug!)} className="ml-auto inline-flex shrink-0 items-center gap-1 text-[12px] text-sky-300 transition hover:text-sky-200">
            <GitCompareArrows size={12} /> diff →
          </button>
        )}
      </div>
      {t.slug && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <UsedForApp checked={active} onToggle={() => onChoose(active ? null : t.slug!)} />
          {/* Flag a version you've tweaked by hand after the agent produced it — the diff may no longer match the file. */}
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-zinc-400 transition hover:text-zinc-200">
            <input type="checkbox" checked={edited} onChange={() => onToggleEdited(t.slug!)} className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-800 accent-violet-500" />
            manually edited
          </label>
        </div>
      )}
    </div>
  );
}

// A landed user redo instruction in a conversation (the agent has, or will, reply with a version).
function RedoNote({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-1.5 px-1 py-0.5 text-[12px] text-violet-200/90">
      <RefreshCw size={12} className="mt-0.5 shrink-0 text-violet-300/70" />
      <span><span className="font-medium text-violet-200">redo:</span> {text}</span>
    </div>
  );
}

// The tailored-résumé section — the version conversation (each agent version diffable, redo notes
// interleaved). Each version carries the "used for application" + "manually edited" checkboxes. Falls
// back to a single flat row for résumés tailored before versioning. (Base lives in its own section.)
function ResumeSection({ p, onDiff, onChoose, onToggleEdited }: { p: Posting; onDiff: (slug: string) => void; onChoose: (v: string | null) => void; onToggleEdited: (slug: string) => void }) {
  const { redoNoteFor } = useAgentQueue();
  const turns = (p.redoLog ?? []).filter((t) => t.phase === "tailor");
  const versions = turns.filter((t) => t.role === "agent").length;
  if (!p.resumeDir && !turns.length) return null;
  const chosen = p.chosenResume ?? null;
  const edited = p.editedResumes ?? [];
  // Pre-versioning résumés have a resumeDir but no version turns — show that one slug as v1.
  const legacy: RedoTurn | null = !turns.length && p.resumeDir ? { phase: "tailor", role: "agent", at: "", text: "", slug: p.resumeDir, version: 1 } : null;
  return (
    <div>
      <SectionLabel>
        Tailored résumé
        {versions > 1 && <span className="ml-2 align-middle text-[11px] font-normal text-zinc-500">{versions} versions</span>}
        {redoNoteFor(p.id, "tailor") !== null && <RedoChip />}
      </SectionLabel>
      <ol className="space-y-1.5">
        {legacy
          ? <li><TailorVersion t={legacy} active={chosen === legacy.slug} edited={edited.includes(legacy.slug!)} onDiff={onDiff} onChoose={onChoose} onToggleEdited={onToggleEdited} /></li>
          : turns.map((t, i) => (
              <li key={i}>
                {t.role === "agent"
                  ? <TailorVersion t={t} active={!!t.slug && chosen === t.slug} edited={!!t.slug && edited.includes(t.slug)} onDiff={onDiff} onChoose={onChoose} onToggleEdited={onToggleEdited} />
                  : <RedoNote text={t.text} />}
              </li>
            ))}
      </ol>
      {chosen === null
        ? <p className="mt-2 text-[12px] text-amber-300/90">Nothing selected yet — check “used for application” on the base or a version.</p>
        : <p className="mt-2 text-[12px] text-zinc-600">Open a version’s diff to redo it with a note.</p>}
    </div>
  );
}

// A subtle, less-prominent tier control (a small dot + dropdown) — the company's tier, editable.
function TierSelect({ tier, onTier }: { tier: Tier; onTier: (t: Tier) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500" title="Company tier">
      <span className={`h-2 w-2 rounded-full ${TIER_META[tier].dot}`} />
      <select
        value={tier}
        onChange={(e) => onTier(e.target.value as Tier)}
        className="-mx-1 cursor-pointer rounded bg-transparent px-1 py-0.5 text-zinc-400 outline-none transition hover:bg-zinc-800/60 focus:bg-zinc-900"
      >
        {TIERS.map((t) => <option key={t} value={t}>{TIER_META[t].label}</option>)}
      </select>
    </label>
  );
}

// Whole days since an ISO date (or null). Drives the "5d ago" relative labels.
function relDays(date?: string | null): number | null {
  if (!date) return null;
  const t = new Date(date.length === 10 ? `${date}T00:00:00` : date).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}
function daysLabel(n: number | null): string | null {
  if (n == null) return null;
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 30) return `${n}d ago`;
  const m = Math.round(n / 30);
  return m <= 1 ? "1mo ago" : `${m}mo ago`;
}

function Chip({ tone = "zinc", children }: { tone?: "zinc" | "sky" | "emerald" | "amber"; children: React.ReactNode }) {
  const cls = tone === "sky" ? "bg-sky-500/15 text-sky-300" : tone === "emerald" ? "bg-emerald-500/15 text-emerald-300"
    : tone === "amber" ? "bg-amber-500/15 text-amber-300" : "bg-zinc-800 text-zinc-400";
  return <span className={`rounded px-1.5 py-0.5 text-[12px] font-medium ${cls}`}>{children}</span>;
}

// The stage-aware highlight card — the most useful at-a-glance facts for where the posting sits:
// Applied = when + how long it's been waiting; Interviewing = progress + what's next; Closed =
// outcome + reapply eligibility + how far it got.
function StageHighlight({ p, col, rounds, reapply, isCurrent = true }: { p: Posting; col: string; rounds: InterviewRound[]; reapply: ReturnType<typeof reapplyInfo>; isCurrent?: boolean }) {
  if (col === "applied") {
    const wait = daysLabel(relDays(p.appliedDate));
    return (
      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/[0.06] px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[13px]">
          <CalendarClock size={14} className="shrink-0 text-yellow-300/80" />
          <span className="font-medium text-zinc-200">Applied{p.appliedDate ? ` ${p.appliedDate}` : ""}</span>
          {wait && <span className="text-zinc-500">· {wait}</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {isCurrent && <Chip tone="amber">awaiting response</Chip>}
          {p.channel === "referral" && <Chip tone="sky">via referral</Chip>}
          {p.source && <Chip>{p.source}</Chip>}
          {p.fitScore != null && <Chip tone="emerald">fit {p.fitScore}</Chip>}
        </div>
      </div>
    );
  }
  if (col === "interviewing") return <InterviewStages p={p} rounds={rounds} />;
  if (col === "closed") {
    const ended = daysLabel(relDays(p.updatedAt ?? p.appliedDate));
    const furthest = [...rounds].reverse().find((r) => r.outcome && r.outcome !== "pending");
    const tone = p.status === "rejected" ? "border-rose-500/20 bg-rose-500/[0.06]" : "border-zinc-700/40 bg-zinc-900/40";
    return (
      <div className={`rounded-lg border px-3 py-2.5 ${tone}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${STATUS_CHIP[p.status]}`}>{STATUS_LABEL[p.status]}</span>
          {ended && <span className="text-[12px] text-zinc-500">{ended}</span>}
          {reapply.state === "eligible" && <span className="ml-auto"><Chip tone="emerald">✓ reapply eligible</Chip></span>}
          {reapply.state === "cooldown" && <span className="ml-auto"><Chip tone="amber">reapply after {reapply.until}</Chip></span>}
        </div>
        {furthest && <p className="mt-1.5 text-[13px] text-zinc-400">Furthest reached: <span className="text-zinc-200">{ROUND_KIND_LABEL[furthest.kind ?? "other"]}</span></p>}
      </div>
    );
  }
  return null;
}

// The pipeline this posting moves through — the stepper at the top of the drawer. Each stage maps
// to the posting states that fall under it (same grouping as the home spine), so the posting's
// current stage = the one whose `states` includes its status.
const DRAWER_STAGES = [
  { key: "scan", label: "Scan", states: ["filtered", "matched", "review", "dismissed"] },
  { key: "fit", label: "Fit", states: ["fit_queue", "assessed", "apply_later"] },
  { key: "tailor", label: "Tailor", states: ["tailoring", "tailored"] },
  { key: "applied", label: "Applied", states: ["applied"] },
  { key: "interview", label: "Interview", states: ["interview", "offer"] },
  { key: "closed", label: "Closed", states: ["accepted", "rejected", "ghost", "withdrawn", "company_skipped", "expired"] },
] as const;
const stageIndexOf = (status: string): number => {
  const i = DRAWER_STAGES.findIndex((s) => (s.states as readonly string[]).includes(status));
  return i < 0 ? 0 : i;
};

// A compact horizontal stepper. Stages up to and including the current one are reached (clickable);
// later stages are grayed out and inert. The selected stage drives the body; the current stage is
// labelled "current".
function StageRail({ current, selected, onSelect }: { current: number; selected: number; onSelect: (i: number) => void }) {
  return (
    <div className="flex items-start">
      {DRAWER_STAGES.map((s, i) => {
        const reached = i <= current;
        const isCurrent = i === current;
        const isSel = i === selected;
        return (
          <div key={s.key} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <span className={`h-0.5 flex-1 ${i > 0 ? (i <= current ? "bg-violet-500/40" : "bg-zinc-800") : "bg-transparent"}`} />
              <button
                type="button"
                disabled={!reached}
                onClick={() => reached && onSelect(i)}
                title={reached ? (isCurrent ? `${s.label} · current` : s.label) : `${s.label} — not reached`}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] leading-none transition ${
                  isSel ? "bg-violet-500 text-violet-50 ring-2 ring-violet-400/50"
                    : reached ? "bg-violet-500/25 text-violet-200 hover:bg-violet-500/40"
                    : "border border-zinc-800 text-zinc-700"
                }`}
              >
                {reached ? (i < current ? "✓" : "●") : ""}
              </button>
              <span className={`h-0.5 flex-1 ${i < DRAWER_STAGES.length - 1 ? (i < current ? "bg-violet-500/40" : "bg-zinc-800") : "bg-transparent"}`} />
            </div>
            <span className={`mt-1 text-[10px] ${isSel ? "font-semibold text-zinc-100" : reached ? "text-zinc-400" : "text-zinc-600"}`}>{s.label}</span>
            {isCurrent && <span className="text-[9px] font-medium uppercase tracking-wide text-violet-300">current</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function CompanyDrawer({
  c, focusId, onClose, onSetStatus, onSetInterviewed, onTier, onDesire, onEditField, onMove, onDelete, onChanged,
}: {
  c: CompanyAgg;
  focusId?: string | null; // when set, scope the drawer to this single job (the only mode now)
  onClose: () => void;
  onSetStatus: (p: Posting, status: Status) => void;
  onSetInterviewed: (p: Posting, interviewed: boolean) => void;
  onTier: (t: Tier) => void;
  onDesire: (d: number | null) => void;
  onToggleWatchlist: (on: boolean) => void;
  onEditField: (p: Posting, changes: Partial<Posting>) => void;
  onMove: (p: Posting, company: string) => void;
  onRename: (name: string) => void;
  onDelete: (p: Posting) => void;
  onChanged?: () => void; // refresh the parent after a direct mutation (rounds CRUD)
}) {
  // Job-scoped: the focused posting (fall back to the most recent if focusId is missing). Computed
  // before the hooks so the stepper's initial selection can key off it (the call site keys the
  // drawer by posting id, so this re-initialises per posting).
  const p = (focusId ? c.items.find((x) => x.id === focusId) : null) ?? c.items[0];
  const currentStage = p ? stageIndexOf(p.status) : 0;
  const [selectedStage, setSelectedStage] = useState(currentStage);
  const [diffSlug, setDiffSlug] = useState<string | null>(null);
  const [fitOpen, setFitOpen] = useState(false);
  // Which interview pane is showing. Persisted, and read by BOTH halves — the bar lives in the
  // header, the pane in the scrolling body. A stored value that no longer names a tab falls back.
  const [storedTab, setInterviewTab] = usePersistentState("landed.drawer.interview.tab", "overview");
  const interviewTab = INTERVIEW_TABS.some((t) => t.key === storedTab) ? storedTab : "overview";
  const { redoNoteFor } = useAgentQueue();
  if (!p) return null;
  const reapply = reapplyInfo(p);
  const rounds = p.interviews ?? [];
  const selKey = DRAWER_STAGES[selectedStage].key;
  // The chat pane sizes itself to the drawer instead of scrolling with it: the body stops being a
  // scroller and becomes a flex column the pane fills, so the only thing that scrolls is the message
  // log inside the chat (its header + composer stay put, the way a chat window should behave).
  const fillsBody = selKey === "interview" && interviewTab === "chat";

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <aside
        className="relative flex h-full w-[720px] max-w-full flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — company headline (prominent), role, location · tier · url, then the stepper */}
        <div className="shrink-0 border-b border-zinc-800 p-5">
          <div className="flex items-center justify-end">
            <button onClick={onClose} className="-mr-1 -mt-1 rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200">
              <X size={18} />
            </button>
          </div>
          <div className="-mt-1 flex items-center gap-2">
            <Building2 size={20} className="shrink-0 text-zinc-500" />
            <EditField
              value={p.company}
              onCommit={(v) => onMove(p, v)}
              placeholder="company"
              className="block w-full text-xl font-bold tracking-tight text-zinc-100"
            />
          </div>
          <EditField
            value={p.role ?? ""}
            onCommit={(v) => onEditField(p, { role: v })}
            placeholder="role"
            className="mt-1 block w-full text-[14px] text-zinc-400"
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <MapPin size={12} className="shrink-0 text-zinc-600" />
              <EditField value={p.location ?? ""} onCommit={(v) => onEditField(p, { location: v })} placeholder="location" className="text-zinc-400" />
            </span>
            <span className="text-zinc-700">·</span>
            <TierSelect tier={c.tier} onTier={onTier} />
            <DesireSelect desire={c.desire} onDesire={onDesire} />
            {p.channel === "referral" && <Chip tone="sky">referral</Chip>}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[13px]">
            <Link2 size={11} className="shrink-0 text-zinc-600" />
            <EditField value={p.url ?? ""} onCommit={(v) => onEditField(p, { url: v })} placeholder="add posting URL…" className="w-full text-[13px] text-sky-400" />
            {p.url && (
              <a href={p.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="shrink-0 text-zinc-500 hover:text-sky-400">
                <ExternalLink size={11} />
              </a>
            )}
          </div>
          <div className="mt-4">
            <StageRail current={currentStage} selected={selectedStage} onSelect={setSelectedStage} />
          </div>
          {selKey === "interview" && <InterviewTabBar active={interviewTab} onChange={setInterviewTab} />}
        </div>

        {/* Body — the selected stage's details (defaults to the current stage). */}
        <div className={`flex-1 p-5 ${fillsBody ? "flex min-h-0 flex-col overflow-hidden" : "space-y-4 overflow-y-auto"}`}>
          {selKey === "scan" && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[13px]"><Radar size={14} className="shrink-0 text-emerald-300" /><span className="font-medium text-zinc-200">Surfaced in discovery</span></div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {p.location && <Chip>{p.location}</Chip>}
                {p.source && <Chip>{p.source}</Chip>}
                {p.discoveredAt && <Chip>found {p.discoveredAt}</Chip>}
              </div>
            </div>
          )}

          {selKey === "fit" && (
            p.fit || p.fitScore != null
              ? <FitSection p={p} onSetStatus={onSetStatus} onOpenDetail={() => setFitOpen(true)} />
              : <EmptyStage>No fit assessment recorded for this posting.</EmptyStage>
          )}

          {selKey === "tailor" && (() => {
            const choose = (v: string | null) => {
              pendo.track("resume_chosen_for_application", {
                posting_id: p.id,
                company: p.company,
                chosen_resume: v,
                is_base: v === "base",
              });
              onEditField(p, { chosenResume: v });
            };
            const toggleEdited = (slug: string) => {
              const cur = p.editedResumes ?? [];
              onEditField(p, { editedResumes: cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug] });
            };
            const hasTailored = !!p.resumeDir || (p.redoLog ?? []).some((t) => t.phase === "tailor");
            return (
              <div className="space-y-5">
                <BaseResumeSection chosen={p.chosenResume ?? null} onChoose={choose} />
                {hasTailored
                  ? <ResumeSection p={p} onDiff={setDiffSlug} onChoose={choose} onToggleEdited={toggleEdited} />
                  : <EmptyStage>No tailored résumé yet — the base is available above.</EmptyStage>}
              </div>
            );
          })()}

          {selKey === "applied" && <StageHighlight p={p} col="applied" rounds={rounds} reapply={reapply} isCurrent={selectedStage === currentStage} />}

          {selKey === "interview" && (
            <InterviewPane
              active={interviewTab}
              p={p}
              rounds={rounds}
              reapply={reapply}
              onChanged={onChanged}
              onSetInterviewed={onSetInterviewed}
            />
          )}

          {selKey === "closed" && (
            <>
              <StageHighlight p={p} col="closed" rounds={rounds} reapply={reapply} />
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
                <label className="flex items-center gap-2 text-[13px]" title="When this closed — sets the reapply cooldown clock">
                  <span className="text-zinc-500">{STATUS_LABEL[p.status]} date</span>
                  <EditField value={p.updatedAt ?? ""} onCommit={(v) => onEditField(p, { updatedAt: v.trim() || undefined })} placeholder="YYYY-MM-DD" className="w-28 tabular-nums text-zinc-200" />
                </label>
                <InterviewedToggle p={p} onSetInterviewed={onSetInterviewed} />
                {isCooling(p.cooldownUntil) && (
                  <CoolingBadge
                    until={p.cooldownUntil!}
                    title={`Discovery is skipping ${p.company} until ${p.cooldownUntil}. Clear it on the Targets table.`}
                  >
                    no new jobs until {p.cooldownUntil}
                  </CoolingBadge>
                )}
              </div>
              {rounds.length > 0 && <div><SectionLabel>Interview history</SectionLabel><InterviewStages p={p} rounds={rounds} /></div>}
              {p.comp && <div><SectionLabel>Comp structure</SectionLabel><p className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[13px] leading-relaxed text-zinc-400">{p.comp}</p></div>}
              {p.teamNotes && <div><SectionLabel>Team · product · work</SectionLabel><p className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[13px] leading-relaxed text-zinc-400">{p.teamNotes}</p></div>}
            </>
          )}
        </div>

        {/* Footer — delete */}
        <div className="shrink-0 border-t border-zinc-800 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => { if (confirm(`Delete ${p.company} — ${p.role ?? "this posting"}? This can't be undone.`)) onDelete(p); }}
              title="Delete this posting completely"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-300"
            >
              <Trash2 size={12} /> delete
            </button>
          </div>
        </div>
      </aside>

      {diffSlug && <ResumeDiffModal key={diffSlug} slug={diffSlug} postingId={p.id} redoNote={redoNoteFor(p.id, "tailor")} annotated={tailorDiffFor(p.redoLog ?? [], diffSlug)} title={`${p.company} — ${p.role ?? ""}`} onClose={() => setDiffSlug(null)} />}
      {fitOpen && <FitDetailModal p={p} onClose={() => setFitOpen(false)} />}
    </div>
  );
}
