"use client";

import { useState } from "react";
import { ChevronRight, Lock, Info } from "lucide-react";

// One stage of the pipeline, rendered as a teaching card. Every node carries the same four facets so
// the page explains itself: what it does · under the hood · what's important · the live artifact.
// `locked` nodes are production components we model but can't run yet (need labels, or volume) — they
// show the concept + an unlock hint instead of an artifact. That honesty IS the lesson.
export default function PipelineNode({
  index, title, subtitle, status = "active", what, hood, important, unlock, defaultOpen = true, children,
}: {
  index: number | string;
  title: string;
  subtitle?: string;
  status?: "active" | "locked" | "illustrative";
  what: string; // one line: what the stage does
  hood?: string; // under the hood: the (toy) implementation actually running
  important: string; // what's important / what breaks at scale
  unlock?: { have: number; need: number }; // for locked nodes: label-count gate
  defaultOpen?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showWhy, setShowWhy] = useState(false); // "what's important" reveals only on the info icon
  const locked = status === "locked";
  const illustrative = status === "illustrative";
  return (
    <div className={`rounded-2xl border bg-zinc-900/30 transition ${locked ? "border-zinc-800/60 opacity-80" : "border-zinc-800"}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold ${
          locked ? "bg-zinc-800 text-zinc-500" : "bg-violet-500/15 text-violet-300"}`}>
          {locked ? <Lock size={12} /> : index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100">{title}</span>
            {subtitle && <span className="text-[12px] text-zinc-500">{subtitle}</span>}
            {locked && <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">locked</span>}
            {illustrative && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">illustrative</span>}
          </div>
          <p className="mt-0.5 text-[13px] leading-snug text-zinc-400">{what}</p>
        </div>
        <ChevronRight size={15} className={`mt-1 shrink-0 text-zinc-600 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="space-y-3 px-4 pb-4 pl-[3.25rem]">
          {hood && (
            <p className="text-[12px] leading-relaxed text-zinc-500">
              <span className="font-medium uppercase tracking-wide text-zinc-600">Under the hood · </span>{hood}
            </p>
          )}
          <div>
            <button
              onClick={() => setShowWhy((v) => !v)}
              title="Why it's important"
              aria-expanded={showWhy}
              className={`inline-flex items-center gap-1 rounded-md p-1 text-amber-400/80 ring-1 ring-inset ring-amber-500/20 transition hover:bg-amber-500/10 ${showWhy ? "bg-amber-500/10" : ""}`}
            >
              <Info size={13} />
            </button>
            {showWhy && (
              <p className="mt-2 rounded-lg bg-amber-500/[0.06] px-3 py-2 text-[12px] leading-relaxed text-amber-200/90 ring-1 ring-inset ring-amber-500/15">
                <span className="font-semibold">What&apos;s important: </span>{important}
              </p>
            )}
          </div>
          {unlock && (
            unlock.have >= unlock.need ? (
              <div className="text-[12px] font-medium text-emerald-300">✓ Unlocked — {unlock.have} labels collected (needed {unlock.need}).</div>
            ) : (
              <div className="text-[12px] text-zinc-500">
                Unlocks at <span className="text-zinc-300">{unlock.need} labels</span> — you have{" "}
                <span className="text-zinc-300">{unlock.have}</span>.
                <div className="mt-1.5 h-1.5 w-48 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-violet-500/70" style={{ width: `${Math.min(100, (unlock.have / unlock.need) * 100)}%` }} />
                </div>
              </div>
            )
          )}
          {children}
        </div>
      )}
    </div>
  );
}

// Shared verdict palette (used by the review table + decide breakdown).
export const VERDICT_TONE: Record<string, string> = {
  met: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/30",
  partial: "text-amber-300 bg-amber-500/10 ring-amber-500/30",
  unmet: "text-rose-300 bg-rose-500/10 ring-rose-500/30",
  unclear: "text-zinc-300 bg-zinc-700/30 ring-zinc-600/40",
  na: "text-zinc-500 bg-zinc-800/40 ring-zinc-700/40",
};
