"use client";

import { useState } from "react";
import { Building2, Sparkles, Target, Loader2, Users, Eye } from "lucide-react";
import type { BriefGap, InterviewBrief, Posting, SourcedText } from "@landed/shared/types";
import { useAgentQueue } from "@/components/AgentQueueProvider";

// Provenance tag on a brief fact/gap — recruiter (said directly) vs JD (fallback) vs online research.
const SOURCE_META: Record<string, { label: string; cls: string }> = {
  recruiter: { label: "recruiter", cls: "bg-emerald-500/15 text-emerald-300" },
  jd: { label: "JD", cls: "bg-zinc-700/70 text-zinc-300" },
  online: { label: "online", cls: "bg-sky-500/15 text-sky-300" },
};
const GAP_TONE: Record<string, string> = { high: "bg-rose-400", medium: "bg-amber-400", low: "bg-sky-400" };

function SourceChip({ source }: { source?: string }) {
  const m = source ? SOURCE_META[source] : undefined;
  if (!m) return null;
  return <span className={`ml-1.5 inline-block rounded px-1 py-0.5 align-middle text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
}

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

// The interview brief — a versioned overview the agent generates from this company's interview-prep
// asset folder (context.md + dropped transcripts + fetched emails). Shows the latest version's
// role · team · what they're looking for · gaps-to-prep, a version switcher, and a Generate button
// that (re)queues the interview-brief job. Live off the shared queue for the queued/working state.
// The agent still reports `tc` and `nextStep`; neither is shown here — comp belongs to the posting
// and peer-comp, and the stage rail above answers "what's next" from the loop itself.
export default function InterviewBriefCard({ p, onChanged }: { p: Posting; onChanged?: () => void }) {
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
