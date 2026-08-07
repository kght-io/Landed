"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, X, ExternalLink, Link2, Trash2, Radar, GitCompareArrows, CheckCircle2, Circle, MapPin, CalendarClock, RefreshCw, Pencil, FileText, Sparkles, Plus, Target, Loader2, MessageSquareText, Mail, FolderOpen, Users, Eye, HelpCircle } from "lucide-react";
import type { BriefGap, InterviewBrief, InterviewRound, Posting, RedoTurn, SourcedText, Status, Tier } from "@landed/shared/types";
import { reapplyInfo, STATUS_LABEL, STATUS_CHIP, TIER_META, TIERS } from "@landed/shared/pipeline/stages";
import { isCooling } from "@landed/shared/pipeline/cooldown";
import { ROUND_KIND_LABEL } from "@landed/shared/prep/landing";
import { type CompanyAgg } from "@landed/shared/pipeline/board";
import InterviewStages from "./InterviewStages";
import CoolingBadge from "./CoolingBadge";
import { AttachmentChip, revealPrepFolder } from "./PrepFiles";
import { useAgentQueue } from "@/components/AgentQueueProvider";
import { tailorDiffFor } from "@landed/shared/jobs/redolog";
import { FitBadge, GapList } from "./Badges";
import ResumeDiffModal from "@/components/ResumeDiff";
import FitDetailModal from "@/components/FitDetail";

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
const EDIT_BASE =
  "-mx-1 rounded bg-transparent px-1 outline-none transition placeholder:text-zinc-600 hover:bg-zinc-800/50 focus:bg-zinc-900 focus:ring-1 focus:ring-zinc-600";
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


// A small section label.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{children}</p>;
}

// Placeholder when a reached stage has no artifact (e.g. applied without a fit assessment).
function EmptyStage({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-5 text-center text-[13px] text-zinc-600">{children}</p>;
}

// One prep-material input row: a dumped-vs-missing dot + label + status line + an action, with an
// optional full-width `below` slot (the emails row lists the files it downloaded there).
function MaterialRow({ icon, label, done, status, children, below }: { icon: React.ReactNode; label: string; done: boolean; status: string; children?: React.ReactNode; below?: React.ReactNode }) {
  return (
    <div className="py-2">
      <div className="flex items-center gap-2.5">
        <span className={`shrink-0 ${done ? "text-emerald-400" : "text-zinc-600"}`}>{done ? <CheckCircle2 size={15} /> : <Circle size={15} />}</span>
        <span className="shrink-0 text-zinc-500">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-zinc-200">{label}</p>
          <p className="text-[12px] text-zinc-500">{status}</p>
        </div>
        {children}
      </div>
      {below}
    </div>
  );
}

// A queue-a-job action button with idle/queuing/queued states (mirrors GeneratePrep's old machine).
function RowButton({ state, label, onClick }: { state: "idle" | "queuing" | "queued"; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={state !== "idle"}
      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[12px] font-medium text-zinc-200 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-700 disabled:opacity-50"
    >
      {state === "queuing" && <Loader2 size={11} className="animate-spin" />}
      {state === "queuing" ? "Queuing\u2026" : state === "queued" ? "Queued" : label}
    </button>
  );
}

type PrepAssets = {
  slug: string;
  emails: { at: string | null; attachments: { name: string; bytes: number }[] };
  questions: { researchedAt: string | null };
  transcripts: { name: string; bytes: number; at: string }[];
  context: { at: string | null };
};

// The three asset INPUTS that feed the interview brief — pull interview emails, research questions,
// add transcript — each with a dumped-vs-missing status, plus a link into the asset folder. Reads
// one status endpoint; each action (re)queues its job or writes a transcript, then refreshes.
function PrepMaterials({ p, onChanged }: { p: Posting; onChanged?: () => void }) {
  const { bump } = useAgentQueue();
  const [assets, setAssets] = useState<PrepAssets | null>(null);
  const [emailState, setEmailState] = useState<"idle" | "queuing" | "queued">("idle");
  const [prepState, setPrepState] = useState<"idle" | "queuing" | "queued">("idle");
  const [prepSlug, setPrepSlug] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);

  const refresh = useCallback(() => {
    fetch(`/api/applications/${p.id}/prep-assets`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setAssets(d as PrepAssets); })
      .catch(() => {});
  }, [p.id]);
  useEffect(() => { refresh(); }, [refresh]);

  const pullEmails = async () => {
    setEmailState("queuing");
    try { await fetch(`/api/applications/${p.id}/interview-emails`, { method: "POST" }); setEmailState("queued"); bump(); }
    catch { setEmailState("idle"); }
  };
  const research = async () => {
    setPrepState("queuing");
    try {
      const res = await fetch(`/api/applications/${p.id}/prep`, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as { slug?: string | null };
      setPrepSlug(d.slug ?? null); setPrepState("queued"); bump();
      pendo.track("interview_prep_generated", { posting_id: p.id });
    } catch { setPrepState("idle"); }
  };
  const emails = assets?.emails;
  const files = emails?.attachments ?? [];
  const researchedAt = assets?.questions?.researchedAt ?? null;
  const transcripts = assets?.transcripts ?? [];
  const slug = assets?.slug ?? prepSlug;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="mb-1 flex items-center justify-between">
        <SectionLabel>Interview prep materials</SectionLabel>
        <button onClick={() => revealPrepFolder(p.id)} title="Reveal the interview-prep folder" className="inline-flex items-center gap-1 text-[12px] text-zinc-400 transition hover:text-zinc-200">
          <FolderOpen size={12} /> open folder
        </button>
      </div>
      <div className="divide-y divide-zinc-800/70">
        <MaterialRow
          icon={<Mail size={15} />}
          label="Interview emails"
          done={!!emails?.at}
          status={emails?.at ? `pulled ${emails.at.slice(0, 10)}${files.length ? ` · ${files.length} file${files.length === 1 ? "" : "s"}` : ""}` : "not pulled yet"}
          below={files.length ? (
            // Every file the recruiter sent, openable. A stage links the ones its rounds claimed;
            // this is the whole folder, so a file no round named is still one click away.
            <div className="mt-1.5 flex flex-wrap gap-1.5 pl-[46px]">
              {files.map((f) => <AttachmentChip key={f.name} postingId={p.id} name={f.name} bytes={f.bytes} />)}
            </div>
          ) : null}
        >
          <RowButton state={emailState} label={emails?.at ? "Re-pull" : "Pull"} onClick={pullEmails} />
        </MaterialRow>

        <MaterialRow
          icon={<HelpCircle size={15} />}
          label="Question research"
          done={!!researchedAt}
          status={researchedAt ? `researched ${researchedAt.slice(0, 10)}` : "not researched yet"}
        >
          <div className="flex items-center gap-2">
            {slug && researchedAt && <a href={`/prep/company/${slug}`} className="text-[12px] font-medium text-sky-300 hover:text-sky-200">view →</a>}
            <RowButton state={prepState} label={researchedAt ? "Re-research" : "Research questions"} onClick={research} />
          </div>
        </MaterialRow>

        <MaterialRow
          icon={<MessageSquareText size={15} />}
          label="Call transcripts"
          done={transcripts.length > 0}
          status={transcripts.length ? `${transcripts.length} added` : "none added yet"}
        >
          <button onClick={() => setShowPaste((v) => !v)} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-800">
            <Plus size={12} /> add
          </button>
        </MaterialRow>
      </div>
      {showPaste && <div className="mt-2 border-t border-zinc-800 pt-2"><TranscriptDrop postingId={p.id} onSaved={() => { refresh(); onChanged?.(); }} /></div>}
    </div>
  );
}

// Provenance tag on a brief fact/gap — recruiter (said directly) vs JD (fallback) vs online research.
const SOURCE_META: Record<string, { label: string; cls: string }> = {
  recruiter: { label: "recruiter", cls: "bg-emerald-500/15 text-emerald-300" },
  jd: { label: "JD", cls: "bg-zinc-700/70 text-zinc-300" },
  online: { label: "online", cls: "bg-sky-500/15 text-sky-300" },
};
function SourceChip({ source }: { source?: string }) {
  const m = source ? SOURCE_META[source] : undefined;
  if (!m) return null;
  return <span className={`ml-1.5 inline-block rounded px-1 py-0.5 align-middle text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
}

const GAP_TONE: Record<string, string> = { high: "bg-rose-400", medium: "bg-amber-400", low: "bg-sky-400" };
function GapRow({ g }: { g: BriefGap }) {
  return (
    <li className="flex gap-2 text-[13px] leading-relaxed">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${GAP_TONE[g.severity ?? ""] ?? "bg-zinc-500"}`} />
      <span className="text-zinc-300">
        <span className="font-medium text-zinc-100">{g.area}</span>
        {g.why ? <span className="text-zinc-500"> — {g.why}</span> : null}
        <SourceChip source={g.source} />
      </span>
    </li>
  );
}

// One overview row (icon · label · sourced value) in the brief. Omitted when the value is empty.
function BriefFact({ icon, label, fact }: { icon: React.ReactNode; label: string; fact?: SourcedText }) {
  if (!fact?.text?.trim()) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-zinc-500">{icon}</span>
      <div className="min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
        <p className="text-[13px] leading-relaxed text-zinc-200">{fact.text}<SourceChip source={fact.source} /></p>
      </div>
    </div>
  );
}

// Paste-a-transcript box + the list of transcripts already dropped for this company. The app can't
// record calls, so you paste one here and it's written to interview-prep/<slug>/transcripts/ — the
// interview-brief job reads that folder to ground the gaps. Fetches the current list on mount.
function TranscriptDrop({ postingId, onSaved }: { postingId: string; onSaved?: () => void }) {
  const [items, setItems] = useState<{ name: string; bytes: number; at: string }[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/applications/${postingId}/transcript`)
      .then((r) => r.json())
      .then((d) => { if (live) setItems(d.transcripts ?? []); })
      .catch(() => {});
    return () => { live = false; };
  }, [postingId]);

  const save = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/applications/${postingId}/transcript`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, title: title.trim() || undefined }),
      });
      const d = (await res.json().catch(() => ({}))) as { transcripts?: typeof items };
      if (d.transcripts) setItems(d.transcripts);
      setTitle(""); setBody("");
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionLabel>Call transcripts</SectionLabel>
      {items.length > 0 && (
        <ul className="mb-2 space-y-1">
          {items.map((t) => (
            <li key={t.name} className="flex items-center gap-2 text-[12px] text-zinc-400">
              <MessageSquareText size={12} className="shrink-0 text-zinc-600" />
              <span className="text-zinc-300">{t.name}</span>
              <span className="text-zinc-600">· {Math.max(1, Math.round(t.bytes / 1024))} KB · {t.at.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      )}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        placeholder="round label (optional) — e.g. System design w/ platform lead"
        className={`${EDIT_BASE} mb-1.5 block w-full rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-[12px] text-zinc-300 focus:border-zinc-600`}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        rows={3}
        placeholder="Paste the interview call transcript…"
        className={`${EDIT_BASE} block w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2 text-[13px] leading-relaxed text-zinc-300 focus:border-zinc-600`}
      />
      <div className="mt-1.5 flex justify-end">
        <button
          onClick={save}
          disabled={saving || !body.trim()}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-800 disabled:opacity-40"
        >
          <Plus size={12} /> {saving ? "Saving…" : "Add transcript"}
        </button>
      </div>
    </div>
  );
}

// The interview brief — a versioned overview the agent generates from this company's interview-prep
// asset folder (context.md + dropped transcripts + fetched emails). Shows the latest version's
// role · team · what they're looking for · gaps-to-prep, a version switcher, and a Generate button
// that (re)queues the interview-brief job. Live off the shared queue for the queued/working state.
// The agent still reports `tc` and `nextStep`; neither is shown here — comp belongs to the posting
// and peer-comp, and the stage rail above answers "what's next" from the loop itself.
function InterviewBriefCard({ p, onChanged }: { p: Posting; onChanged?: () => void }) {
  const { jobs, bump } = useAgentQueue();
  const briefs = p.interviewBriefs ?? [];
  const [selVersion, setSelVersion] = useState<number | null>(null);
  const [queuing, setQueuing] = useState(false);

  const job = jobs.find((j) => j.id === `interview-brief-${p.id}`);
  const working = job?.status === "wip";
  const queued = job?.status === "queued" || (!!job && !working) || queuing;

  const latest = briefs.length ? briefs[briefs.length - 1] : null;
  const current: InterviewBrief | null =
    (selVersion != null ? briefs.find((b) => b.version === selVersion) : null) ?? latest;

  const generate = async () => {
    setQueuing(true);
    try {
      await fetch(`/api/applications/${p.id}/interview-brief`, { method: "POST" });
      bump();
      onChanged?.();
    } finally {
      setQueuing(false);
    }
  };

  const btnLabel = working ? "Generating…" : queued ? "Queued…" : briefs.length ? "Re-generate" : "Generate brief";

  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.05] p-3">
      <div className="flex items-center gap-2.5">
        <Sparkles size={16} className="shrink-0 text-violet-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-zinc-200">Interview brief</p>
          <p className="text-[12px] text-zinc-500">Role · team · what they want · gaps, from your dumped materials.</p>
        </div>
        <button
          onClick={generate}
          disabled={working || queued}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-violet-500/90 px-2.5 py-1 text-[13px] font-medium text-violet-950 transition hover:bg-violet-400 disabled:opacity-50"
        >
          {(working || queued) && <Loader2 size={12} className="animate-spin" />}
          {btnLabel}
        </button>
      </div>

      {briefs.length > 1 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          {briefs.map((b) => {
            const on = current?.version === b.version;
            return (
              <button
                key={b.version}
                onClick={() => setSelVersion(b.version)}
                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold transition ${on ? "bg-violet-500/25 text-violet-100" : "text-zinc-400 hover:bg-zinc-800"}`}
              >
                v{b.version}
              </button>
            );
          })}
        </div>
      )}

      {current ? (
        <div className="mt-3 space-y-3 border-t border-violet-500/15 pt-3">
          <div className="space-y-2.5">
            {/* Comp lives on the posting and in peer-comp; the next step is the stage rail above. */}
            <BriefFact icon={<Building2 size={13} />} label="Role" fact={current.role} />
            <BriefFact icon={<Users size={13} />} label="Team" fact={current.team} />
            <BriefFact icon={<Eye size={13} />} label="What they're looking for" fact={current.expectations} />
          </div>
          {current.summary && <p className="text-[13px] leading-relaxed text-zinc-300">{current.summary}</p>}
          {!!current.gaps?.length && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <Target size={12} /> Gaps to prep
              </div>
              <ul className="space-y-1">{current.gaps.map((g, i) => <GapRow key={i} g={g} />)}</ul>
            </div>
          )}
          <p className="text-[11px] text-zinc-600">
            v{current.version} · generated {current.generatedAt.slice(0, 10)}
            {current.materials?.length ? ` · ${current.materials.join(", ")}` : ""}
          </p>
        </div>
      ) : (
        <p className="mt-3 border-t border-violet-500/15 pt-3 text-[12px] text-zinc-500">
          {working || queued
            ? "Queued in the agent — reading your dumped materials to build the brief."
            : "No brief yet. Feed the inputs below (emails · questions · transcripts), then generate one."}
        </p>
      )}
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
          <a href="/api/resume/base" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-sky-300 transition hover:text-sky-200">
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
  c, focusId, onClose, onSetStatus, onSetInterviewed, onTier, onEditField, onMove, onDelete, onChanged,
}: {
  c: CompanyAgg;
  focusId?: string | null; // when set, scope the drawer to this single job (the only mode now)
  onClose: () => void;
  onSetStatus: (p: Posting, status: Status) => void;
  onSetInterviewed: (p: Posting, interviewed: boolean) => void;
  onTier: (t: Tier) => void;
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
  const { redoNoteFor } = useAgentQueue();
  if (!p) return null;
  const reapply = reapplyInfo(p);
  const rounds = p.interviews ?? [];
  const selKey = DRAWER_STAGES[selectedStage].key;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <aside
        className="relative flex h-full w-[480px] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
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
        </div>

        {/* Body — the selected stage's details (defaults to the current stage). */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
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
            <>
              <StageHighlight p={p} col="interviewing" rounds={rounds} reapply={reapply} />
              <InterviewBriefCard p={p} onChanged={onChanged} />
              <PrepMaterials p={p} onChanged={onChanged} />
              <InterviewedToggle p={p} onSetInterviewed={onSetInterviewed} />
            </>
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

          {p.note && (
            <div>
              <SectionLabel>Notes</SectionLabel>
              <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[13px] leading-relaxed text-zinc-400">{p.note}</p>
            </div>
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
