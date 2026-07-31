"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FlaskConical, Loader2, Play, FileText, ChevronDown } from "lucide-react";
import PipelineNode, { VERDICT_TONE } from "@/components/fitlab/PipelineNode";
import { ago } from "@landed/shared/format";
import type { Criterion, Run, VerdictRow, Verdict, Decision } from "@landed/shared/fitlab/types";

type RunSummary = { id: number; company: string; role: string; score: number | null; decision: string | null; pending: boolean; createdAt: string };
type PostingOpt = { id: number; company: string; role: string; location: string | null };
type LabelStats = { labeled: number; total: number };

const VERDICT_OPTS: Verdict[] = ["met", "partial", "unmet", "unclear", "na"];
const DECISION_TONE: Record<string, string> = {
  advance: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/30",
  review: "text-amber-300 bg-amber-500/10 ring-amber-500/30",
  drop: "text-rose-300 bg-rose-500/10 ring-rose-500/30",
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${tone}`}>{children}</span>;
}

export default function FitLab() {
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [postingsList, setPostingsList] = useState<PostingOpt[]>([]);
  const [labelStats, setLabelStats] = useState<LabelStats>({ labeled: 0, total: 0 });
  const [profile, setProfile] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [mode, setMode] = useState<"posting" | "paste">("posting");
  const [postingId, setPostingId] = useState<number | "">("");
  const [paste, setPaste] = useState({ company: "", role: "", jd: "" });

  const [run, setRun] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);
  const [pendingRunId, setPendingRunId] = useState<number | null>(null); // queued, waiting on the agent
  const [error, setError] = useState<string | null>(null);
  const [showProduction, setShowProduction] = useState(false); // modeled production nodes — collapsed by default
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadBootstrap = useCallback(() => {
    fetch("/api/fitlab/run").then((r) => r.json()).then((d) => {
      setCriteria(d.criteria ?? []);
      setRuns(d.runs ?? []);
      setLabelStats(d.labelStats ?? { labeled: 0, total: 0 });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadBootstrap();
    fetch("/api/fitlab/postings").then((r) => r.json()).then((d) => setPostingsList(d.postings ?? [])).catch(() => {});
    fetch("/api/fitlab/profile").then((r) => r.json()).then((d) => setProfile(d.profile ?? "")).catch(() => {});
  }, [loadBootstrap]);

  // Stop any in-flight poll on unmount.
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Poll a pending run until the agent has submitted its verdicts (verdicts.length > 0), then show it.
  const pollRun = useCallback((runId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const d = await fetch(`/api/fitlab/run?id=${runId}`).then((r) => r.json()).catch(() => null);
      if (d?.run && d.run.verdicts.length > 0) {
        if (pollRef.current) clearInterval(pollRef.current);
        setRun(d.run); setPendingRunId(null); loadBootstrap();
      }
    }, 3000);
  }, [loadBootstrap]);

  // QUEUE an agent job (no direct LLM API). The run is created pending; the agent processes it from the
  // queue and the page polls until its verdicts land.
  const runAssessment = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const body = mode === "posting" ? { postingId } : paste;
      const r = await fetch("/api/fitlab/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "could not queue");
      pendo.track("fitlab_assessment_queued", {
        mode,
        posting_id: mode === "posting" ? postingId : undefined,
        company: mode === "paste" ? paste.company : undefined,
        role: mode === "paste" ? paste.role : undefined,
      });
      setRun(null);
      setPendingRunId(d.runId);
      loadBootstrap();
      pollRun(d.runId);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setRunning(false);
    }
  }, [mode, postingId, paste, loadBootstrap, pollRun]);

  const loadRun = useCallback((id: number) => {
    fetch(`/api/fitlab/run?id=${id}`).then((r) => r.json()).then((d) => {
      if (!d.run) return;
      if (d.run.verdicts.length === 0) { setRun(null); setPendingRunId(id); pollRun(id); } // still queued
      else { if (pollRef.current) clearInterval(pollRef.current); setPendingRunId(null); setRun(d.run); }
    }).catch(() => {});
  }, [pollRun]);

  const label = useCallback(async (verdictId: number, humanVerdict: Verdict | null, humanNote?: string | null) => {
    const r = await fetch("/api/fitlab/label", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ verdictId, humanVerdict, humanNote }) });
    const d = await r.json();
    if (d.run) {
      const v = (d.run as Run).verdicts.find((x: VerdictRow) => x.id === verdictId);
      pendo.track("fitlab_verdict_labeled", {
        verdict_id: verdictId,
        criterion_key: v?.criterionKey,
        model_verdict: v?.verdict,
        human_verdict: humanVerdict,
        was_overturned: humanVerdict != null && humanVerdict !== v?.verdict,
        has_note: !!humanNote,
      });
      setRun(d.run); loadBootstrap();
    }
  }, [loadBootstrap]);

  const saveProfile = useCallback(async () => {
    setSavingProfile(true);
    try {
      await fetch("/api/fitlab/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile }) });
      pendo.track("fitlab_profile_saved", { profile_length: profile.length });
    }
    finally { setSavingProfile(false); }
  }, [profile]);

  const canRun = mode === "posting" ? postingId !== "" : paste.jd.trim().length >= 50;
  // A modeled production component unlocks once you've collected enough labels to build it.
  const gate = (need: number): "active" | "locked" => (labelStats.labeled >= need ? "active" : "locked");
  const stage = (name: string) => run?.stages.find((s) => s.stage === name)?.artifact as Record<string, unknown> | unknown[] | undefined;
  const extractArt = stage("extract") as Record<string, string> | undefined;
  const decideArt = stage("decide") as { score: number; decision: Decision; contributions: { key: string; label: string; type: string; verdict: string; weight: number }[]; gateVetoes: string[]; uncertain: string[] } | undefined;
  const labelOf = (k: string) => criteria.find((c) => c.key === k)?.label ?? k;

  return (
    <div className="flex h-full flex-col text-zinc-100">
      <header className="border-b border-zinc-800/80 px-6 py-3.5">
        <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <FlaskConical size={16} className="text-violet-300" /> Fit Lab
        </h1>
        <p className="mt-0.5 text-[13px] text-zinc-500">
          Fit assessment modeled as a production classification pipeline — Extract → Detect → Decide → Review.
          Each node explains itself; your overrides become labels that unlock the rest.
        </p>
      </header>

      <div className="flex flex-1 overflow-hidden">
       <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-3xl space-y-4">
          {/* ── Input panel ───────────────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
            <div className="mb-3 flex items-center gap-1.5">
              {(["posting", "paste"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition ${mode === m ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
                  {m === "posting" ? "Existing posting" : "Paste JD"}
                </button>
              ))}
            </div>

            {mode === "posting" ? (
              <select value={postingId} onChange={(e) => setPostingId(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-md bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-200 outline-none ring-1 ring-inset ring-zinc-800 focus:ring-zinc-600">
                <option value="">Pick a posting with a JD…</option>
                {postingsList.map((p) => (
                  <option key={p.id} value={p.id}>{p.company} — {p.role}{p.location ? ` (${p.location})` : ""}</option>
                ))}
              </select>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input value={paste.company} onChange={(e) => setPaste((s) => ({ ...s, company: e.target.value }))} placeholder="Company"
                    className="w-1/2 rounded-md bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-200 outline-none ring-1 ring-inset ring-zinc-800 focus:ring-zinc-600" />
                  <input value={paste.role} onChange={(e) => setPaste((s) => ({ ...s, role: e.target.value }))} placeholder="Role"
                    className="w-1/2 rounded-md bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-200 outline-none ring-1 ring-inset ring-zinc-800 focus:ring-zinc-600" />
                </div>
                <textarea value={paste.jd} onChange={(e) => setPaste((s) => ({ ...s, jd: e.target.value }))} placeholder="Paste the job description…" rows={5}
                  className="w-full resize-y rounded-md bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-200 outline-none ring-1 ring-inset ring-zinc-800 focus:ring-zinc-600" />
              </div>
            )}

            <div className="mt-3 flex items-center gap-3">
              <button onClick={runAssessment} disabled={!canRun || running}
                className="inline-flex items-center gap-1.5 rounded-md bg-violet-500/15 px-3 py-1.5 text-[13px] font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30 transition hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-40">
                {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                {running ? "Queuing…" : "Queue assessment"}
              </button>
              <button onClick={() => setProfileOpen((o) => !o)} className="inline-flex items-center gap-1 text-[12px] text-zinc-500 transition hover:text-zinc-300">
                <FileText size={12} /> Profile <ChevronDown size={12} className={profileOpen ? "rotate-180 transition-transform" : "transition-transform"} />
              </button>
              {error && <span className="text-[12px] text-rose-400">{error}</span>}
            </div>

            {profileOpen && (
              <div className="mt-3 space-y-2">
                <p className="text-[12px] text-zinc-500">The candidate profile the Detect stage judges against (seeded from your base resume).</p>
                <textarea value={profile} onChange={(e) => setProfile(e.target.value)} rows={8}
                  className="w-full resize-y rounded-md bg-zinc-900 px-2.5 py-2 font-mono text-[12px] leading-relaxed text-zinc-300 outline-none ring-1 ring-inset ring-zinc-800 focus:ring-zinc-600" />
                <button onClick={saveProfile} disabled={savingProfile}
                  className="rounded-md bg-zinc-800 px-2.5 py-1 text-[12px] font-medium text-zinc-200 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-700 disabled:opacity-40">
                  {savingProfile ? "Saving…" : "Save profile"}
                </button>
              </div>
            )}

          </div>

          {/* ── The pipeline ──────────────────────────────────────────────────────── */}
          {pendingRunId != null && !run ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-violet-500/30 bg-violet-500/[0.04] py-10 text-center text-[13px] text-zinc-400">
              <Loader2 size={16} className="animate-spin text-violet-300" />
              <p>Queued for Fit Lab (run #{pendingRunId}) — <span className="text-zinc-300">run your queue</span> to process it.</p>
              <p className="text-[12px] text-zinc-600">No direct API call — the Fit Lab pipeline runs the judgment over MCP. Verdicts appear here when it finishes.</p>
            </div>
          ) : !run ? (
            <div className="rounded-2xl border border-dashed border-zinc-800/80 py-12 text-center text-[13px] text-zinc-600">
              Queue an assessment, then run your queue to trace a posting through the pipeline.
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* 0 · Ingest */}
              <PipelineNode index={0} title="Ingest" status="active"
                what={`${run.company} — ${run.role}`}
                important="The item entering the system. In production this is a queue; here it's one posting (existing or pasted JD)."
                defaultOpen={false}>
                <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-900/60 p-2.5 text-[12px] leading-relaxed text-zinc-400 ring-1 ring-inset ring-zinc-800">
                  {run.jd.slice(0, 1200)}{run.jd.length > 1200 ? "…" : ""}
                </p>
              </PipelineNode>

              {/* 1 · Extract */}
              <PipelineNode index={1} title="Extract" status="active"
                what="Parse the JD into one structured requirement per criterion category."
                hood="Fit Lab returns a requirement phrase per category over MCP — no direct API call. The Detect step judges against THESE, not the raw JD."
                important="Structured features beat raw text — and extraction errors propagate downstream (garbage in, garbage out).">
                <div className="space-y-1.5">
                  {criteria.map((c) => (
                    <div key={c.key} className="flex gap-2 text-[12px]">
                      <span className="w-36 shrink-0 text-zinc-500">{c.label}</span>
                      <span className="text-zinc-300">{extractArt?.[c.key] ?? "—"}</span>
                    </div>
                  ))}
                </div>
              </PipelineNode>

              {/* 2 · Detect */}
              <PipelineNode index={2} title="Detect — LLM judge" status="active"
                what="Judge each requirement against the profile → graded verdict + confidence + evidence."
                hood="Fit Lab returns a verdict per criterion over MCP — the accurate judge lane. A cheap distilled classifier (locked below) would shadow it once labels exist."
                important="Verdicts only — never a 0–100 score. The model does perception; code does the decision (next node). That keeps the score reproducible and every criterion a labelable unit.">
                <div className="space-y-1.5">
                  {run.verdicts.map((v) => (
                    <div key={v.id} className="flex items-start gap-2 text-[12px]">
                      <span className="w-36 shrink-0 text-zinc-500">{labelOf(v.criterionKey)}</span>
                      <Pill tone={VERDICT_TONE[v.verdict]}>{v.verdict}</Pill>
                      <span className="shrink-0 tabular-nums text-zinc-600">{v.confidence ?? "?"}%</span>
                      <span className="text-zinc-400">{v.evidence ?? v.reasoning ?? ""}</span>
                    </div>
                  ))}
                </div>
              </PipelineNode>

              {/* 3 · Decide */}
              <PipelineNode index={3} title="Decide" status="active"
                what="Aggregate verdicts → score + decision, deterministically."
                hood="Pure code (decide.ts): gates veto, the rest contribute a weighted average. Confidence below the band would route to human review."
                important="This is the tunable policy layer — thresholds set a precision/recall target. Separating it from the LLM means you can retune without re-prompting.">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-semibold tabular-nums text-zinc-100">{run.score ?? "—"}</span>
                    {run.decision && <Pill tone={DECISION_TONE[run.decision]}>{run.decision}</Pill>}
                    {decideArt && decideArt.gateVetoes.length > 0 && <span className="text-[12px] text-rose-400">gate veto: {decideArt.gateVetoes.map(labelOf).join(", ")}</span>}
                  </div>
                  {decideArt?.uncertain && decideArt.uncertain.length > 0 && (
                    <p className="text-[12px] text-amber-300/90">Below confidence band (would route to review): {decideArt.uncertain.map(labelOf).join(", ")}</p>
                  )}
                  <div className="space-y-1">
                    {(decideArt?.contributions ?? []).map((c) => (
                      <div key={c.key} className="flex items-center gap-2 text-[12px]">
                        <span className="w-36 shrink-0 text-zinc-500">{c.label}</span>
                        <span className="w-12 shrink-0 text-[11px] uppercase text-zinc-600">{c.type}</span>
                        <Pill tone={VERDICT_TONE[c.verdict]}>{c.verdict}</Pill>
                        <span className="text-zinc-600">×{c.weight}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </PipelineNode>

              {/* 4 · Review (HITL) */}
              <PipelineNode index={4} title="Review — human-in-the-loop" status="active"
                what="Correct any verdict. Your override is the LABEL the rest of the pipeline learns from."
                hood="Each override writes a label and instantly recomputes the decision above."
                important="This is the flywheel. Overturn rate is an online quality signal; the labels become the eval set and (later) the cheap classifier's training data.">
                <ReviewStage verdicts={run.verdicts} profile={profile} labelOf={labelOf} onLabel={label} totalLabels={labelStats.labeled} />
              </PipelineNode>

              {/* ── Modeled production nodes — collapsed behind a toggle (talked through, not shown) ── */}
              <button
                onClick={() => setShowProduction((v) => !v)}
                className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 transition hover:text-zinc-300"
              >
                <ChevronDown size={13} className={`transition-transform ${showProduction ? "" : "-rotate-90"}`} />
                Production components <span className="font-normal normal-case text-zinc-600">· modeled ({showProduction ? "hide" : "7"})</span>
              </button>

              {showProduction && (
                <>
              <PipelineNode index="C" title="Cheap classifier" status={gate(30)}
                what="A distilled model that shadows the LLM judge on the hot path."
                hood="Will train a small model (kNN / logistic regression over embeddings) on your labels, then run ~1000× cheaper than the LLM."
                important="Distillation: train a cheap model on the expensive model's + humans' labels; reserve the LLM for the uncertain band (the cascade). This is how high-volume systems avoid running a big LLM per item."
                unlock={{ have: labelStats.labeled, need: 30 }} defaultOpen={false} />

              <PipelineNode index="A" title="Active learning" status={gate(20)}
                what="Pick the most informative items to label next."
                hood="Will rank unlabeled verdicts by uncertainty (near the confidence band / LLM↔classifier disagreement) and surface those first."
                important="You can't label everything — labeling the uncertain cases teaches the system fastest per label."
                unlock={{ have: labelStats.labeled, need: 20 }} defaultOpen={false} />

              <PipelineNode index="E" title="Eval" status={gate(20)}
                what="Precision / recall / F1 per criterion against your labels."
                hood="Will compute a confusion matrix per category + a regression gate (does a rubric edit beat the previous version before you ship it?)."
                important="The discipline that separates 'I tweaked a prompt' from 'I shipped a measured change.' Everything else depends on this ruler."
                unlock={{ have: labelStats.labeled, need: 20 }} defaultOpen={false} />

              <PipelineNode index="K" title="Calibration" status={gate(50)}
                what="Learn your decision thresholds from data."
                hood="Will fit a logistic regression: criterion verdicts → your actual advance/drop decisions."
                important="Learns your preferences with interpretable weights and no training infra — not fine-tuning."
                unlock={{ have: labelStats.labeled, need: 50 }} defaultOpen={false} />

              <PipelineNode index="D" title="Drift monitor" status="illustrative"
                what="Watch the verdict/score distribution shift over time."
                hood="Mechanism is real (compare a recent batch's distribution vs a reference), but only meaningful at volume."
                important="Models rot as inputs shift. At your scale this is a demonstration of the mechanism, not a load-bearing signal — say so in interviews."
                defaultOpen={false} />

              <PipelineNode index="G" title="Annotator agreement" status="illustrative"
                what="Inter-annotator agreement (Cohen's kappa)."
                hood="You're a single labeler, so a 2nd LLM pass (different prompt/temp) stands in as a synthetic 2nd annotator."
                important="One labeler is a noisy oracle. Agreement metrics tell you how trustworthy your ground truth is — here it's illustrative, not real consensus."
                defaultOpen={false} />

              <PipelineNode index="F" title="Feedback" status={gate(30)}
                what="Close the loop — labels improve the system."
                hood="Will retrain the cheap classifier + refit calibration on accumulated labels, then re-run eval to show P/R move."
                important="Feedback ≠ retraining the LLM. It flows three ways: rubric edits, retrieved exemplars, and the calibration/classifier refit."
                unlock={{ have: labelStats.labeled, need: 30 }} defaultOpen={false} />
                </>
              )}
            </div>
          )}
        </div>
       </div>
       <RunsPanel runs={runs} activeId={run?.id ?? pendingRunId} onSelect={loadRun} />
      </div>
    </div>
  );
}

// Right panel — the FULL run history, newest first (listRuns sorts desc). Click to load a run into the
// pipeline. Pending runs (queued for the agent, no verdicts yet) show as "queued".
function RunsPanel({ runs, activeId, onSelect }: {
  runs: { id: number; company: string; role: string; score: number | null; decision: string | null; pending: boolean; createdAt: string }[];
  activeId: number | null; onSelect: (id: number) => void;
}) {
  const tone: Record<string, string> = { advance: "text-emerald-300", review: "text-amber-300", drop: "text-rose-300" };
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-zinc-800/80 bg-zinc-950/40">
      <div className="border-b border-zinc-800/60 px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
        Runs <span className="text-zinc-600">({runs.length})</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {runs.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-zinc-600">No runs yet.</p>
        ) : (
          runs.map((r) => (
            <button key={r.id} onClick={() => onSelect(r.id)}
              className={`flex w-full flex-col gap-0.5 border-b border-zinc-900 px-4 py-2.5 text-left transition hover:bg-zinc-900/60 ${activeId === r.id ? "bg-zinc-900/80" : ""}`}>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-200">{r.company}</span>
                {r.pending ? (
                  <span className="shrink-0 text-[11px] text-violet-300">queued</span>
                ) : (
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-zinc-300">{r.score ?? "—"}</span>
                )}
              </div>
              <div className="flex items-baseline gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-zinc-500">{r.role}</span>
                {!r.pending && r.decision && <span className={`shrink-0 font-medium ${tone[r.decision] ?? "text-zinc-500"}`}>{r.decision}</span>}
              </div>
              <span className="text-[11px] text-zinc-600">{ago(r.createdAt)}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

// The Review stage body: an overturn summary (the online quality signal), a toggle to reveal the
// SOURCE profile (so you verify the model's evidence against ground truth — not the model's own
// claim), and the per-verdict review rows.
function ReviewStage({ verdicts, profile, labelOf, onLabel, totalLabels }: {
  verdicts: VerdictRow[]; profile: string; labelOf: (k: string) => string;
  onLabel: (id: number, hv: Verdict | null, note?: string | null) => void; totalLabels: number;
}) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const labeled = verdicts.filter((v) => v.humanVerdict != null).length;
  const overturned = verdicts.filter((v) => v.humanVerdict != null && v.humanVerdict !== v.verdict).length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <span className="text-zinc-400">{labeled}/{verdicts.length} reviewed</span>
        <span className={overturned ? "font-medium text-amber-300" : "text-zinc-600"}>{overturned} overturned</span>
        {labeled > 0 && <span className="text-zinc-600">· overturn rate {Math.round((overturned / labeled) * 100)}%</span>}
        <button onClick={() => setSourceOpen((o) => !o)} className="ml-auto inline-flex items-center gap-1 text-zinc-500 transition hover:text-zinc-300">
          <FileText size={12} /> {sourceOpen ? "Hide" : "Show"} source profile
        </button>
      </div>
      {sourceOpen && (
        <div className="rounded-lg bg-zinc-900/60 p-2.5 ring-1 ring-inset ring-zinc-800">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-600">Source — check evidence against THIS, not the model&apos;s claim</p>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-zinc-400">{profile}</pre>
        </div>
      )}
      {verdicts.map((v) => (
        <ReviewRow key={v.id} v={v} label={labelOf(v.criterionKey)} onLabel={onLabel} />
      ))}
      <p className="pt-1 text-[12px] text-zinc-600">{totalLabels} labels collected across all runs.</p>
    </div>
  );
}

// One reviewable verdict. Side by side: what the JD asked vs what the résumé shows (the model's cited
// evidence — a CLAIM, verify it against the source above). The override select is the label.
function ReviewRow({ v, label, onLabel }: { v: VerdictRow; label: string; onLabel: (id: number, hv: Verdict | null, note?: string | null) => void }) {
  const [note, setNote] = useState(v.humanNote ?? "");
  const overridden = v.humanVerdict != null && v.humanVerdict !== v.verdict;
  return (
    <div className={`rounded-lg ring-1 ring-inset ${overridden ? "bg-violet-500/[0.06] ring-violet-500/20" : "bg-zinc-900/40 ring-zinc-800"}`}>
      <div className="flex flex-wrap items-center gap-2 px-2.5 pt-2 text-[12px]">
        <span className="font-medium text-zinc-300">{label}</span>
        <span className="ml-auto text-zinc-600">model</span>
        <Pill tone={VERDICT_TONE[v.verdict]}>{v.verdict}</Pill>
        <span className="tabular-nums text-zinc-600">{v.confidence ?? "?"}%</span>
        <span className="text-zinc-600">→ you</span>
        <select value={v.humanVerdict ?? ""} onChange={(e) => onLabel(v.id, (e.target.value || null) as Verdict | null, note)}
          className="rounded bg-zinc-900 px-1.5 py-0.5 text-[12px] text-zinc-200 ring-1 ring-inset ring-zinc-700 outline-none focus:ring-zinc-500">
          <option value="">— agree —</option>
          {VERDICT_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {v.humanVerdict && <button onClick={() => onLabel(v.id, null)} className="text-[11px] text-zinc-600 hover:text-zinc-300">clear</button>}
      </div>
      <div className="mt-1.5 grid grid-cols-2 px-2.5 pb-1">
        <div className="pr-2.5">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">JD asks</p>
          <p className="text-[12px] leading-snug text-zinc-300">{v.requirement ?? "—"}</p>
        </div>
        <div className="border-l border-zinc-800 pl-2.5">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Résumé shows <span className="font-normal lowercase text-zinc-700">· model&apos;s evidence</span></p>
          <p className="text-[12px] leading-snug text-zinc-400">{v.evidence ?? "—"}</p>
        </div>
      </div>
      {v.reasoning && <p className="px-2.5 pb-1.5 text-[11px] italic leading-snug text-zinc-600">{v.reasoning}</p>}
      {(overridden || note) && (
        <div className="px-2.5 pb-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => v.humanVerdict && onLabel(v.id, v.humanVerdict, note)}
            placeholder="why? (this note travels with the label)"
            className="w-full rounded bg-zinc-900 px-2 py-1 text-[12px] text-zinc-300 ring-1 ring-inset ring-zinc-800 outline-none focus:ring-zinc-600" />
        </div>
      )}
    </div>
  );
}
