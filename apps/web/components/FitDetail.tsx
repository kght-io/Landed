"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, FileText, Gauge, RefreshCw, X } from "lucide-react";
import RedoComposer from "@/components/RedoComposer";
import { useAgentQueue } from "@/components/AgentQueueProvider";
import { FitBadge, LevelBadge, GapList, StrengthsList } from "@/components/board/Badges";
import type { Posting } from "@landed/shared/types";

// The full fit assessment as a modal — the counterpart to ResumeDiffModal for the fit phase. The
// drawer shows a compact preview (summary + gaps); clicking it opens this, which holds the complete
// assessment (level call, strengths, detailed gaps, summary), the version history + redo
// conversation, and a prominent "redo with a note" composer pinned below so you can re-request a
// re-assessment while reading the detail.
export default function FitDetailModal({ p, onClose }: { p: Posting; onClose: () => void }) {
  const { redoNoteFor } = useAgentQueue();
  // The JD is large, so it's not on the board payload — fetch it lazily when the modal opens.
  const [jd, setJd] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    let live = true;
    fetch(`/api/scanned/${p.id}`).then((r) => r.json()).then((d) => { if (live) setJd(d.jd ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [p.id]);

  const fit = p.fit;
  const turns = (p.redoLog ?? []).filter((t) => t.phase === "fit");
  const lastAgentIdx = turns.map((t) => t.role).lastIndexOf("agent");
  const history = turns.filter((_, i) => i !== lastAgentIdx); // everything but the latest (shown in full above)

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
          <Gauge size={15} className="shrink-0 text-violet-300" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-zinc-200">{p.company} — {p.role ?? ""}</div>
            <div className="truncate text-[11px] text-zinc-500">Fit assessment</div>
          </div>
          {p.fitScore != null && <FitBadge score={p.fitScore} />}
          <button onClick={onClose} title="Close (Esc)" className="shrink-0 text-zinc-500 transition hover:text-zinc-200"><X size={16} /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-auto p-4">
          {jd && (
            <details className="group rounded-lg border border-zinc-800 bg-zinc-900/40">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400 transition hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
                <ChevronRight size={13} className="shrink-0 transition group-open:rotate-90" />
                <FileText size={12} className="shrink-0" />
                Job description
              </summary>
              <div className="max-h-72 overflow-auto border-t border-zinc-800 px-3 py-2.5">
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-zinc-400">{jd}</p>
              </div>
            </details>
          )}

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            {fit?.levelMatch?.call && (
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <LevelBadge level={fit.levelMatch.call} />
                {fit.recommendation && <span className="text-[12px] text-zinc-500">· rec: {fit.recommendation}</span>}
              </div>
            )}
            {fit?.levelMatch?.why && <p className="mb-2 text-[13px] leading-relaxed text-zinc-400">{fit.levelMatch.why}</p>}
            {!!fit?.strengths?.length && (
              <div className="mb-2.5">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-emerald-300/70">strengths</p>
                <StrengthsList strengths={fit.strengths} />
              </div>
            )}
            {!!fit?.gaps?.length && (
              <div className="mb-2.5">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-rose-300/70">gaps</p>
                <GapList gaps={fit.gaps} />
              </div>
            )}
            {fit?.summary && <p className="text-[13px] leading-relaxed text-zinc-300">{fit.summary}</p>}
            {!fit && <p className="text-[13px] text-zinc-500">No detailed assessment recorded.</p>}
          </div>

          {history.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">History</p>
              <ol className="space-y-1.5">
                {history.map((t, i) => (
                  <li key={i}>
                    {t.role === "agent" ? (
                      <p className="text-[12px] text-zinc-500">
                        <span className="rounded bg-zinc-800 px-1 text-[11px] font-medium text-zinc-400">v{t.version}</span> fit {t.fitScore ?? "?"} — {t.text}
                      </p>
                    ) : (
                      <p className="flex items-start gap-1.5 text-[12px] text-violet-200/90">
                        <RefreshCw size={12} className="mt-0.5 shrink-0 text-violet-300/70" />
                        <span><span className="font-medium text-violet-200">redo:</span> {t.text}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <RedoComposer postingId={p.id} phase="fit" initialNote={redoNoteFor(p.id, "fit") ?? undefined} />
      </div>
    </div>,
    document.body,
  );
}
