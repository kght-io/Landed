"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Coins, Loader2, RefreshCw, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAgentQueue } from "@/components/AgentQueueProvider";
import type { PeerComp } from "@landed/shared/types";

// Peer comp comparison — a popup showing the six-column table (Role · Base · Bonus · Equity ·
// Company stage · Upside character) across every role you're actively interviewing for. Generation
// runs through the agent job queue (type "peer-comp") — NOT a direct API call — so clicking
// "Generate" queues a job; the popup shows a working state, then renders the markdown once the agent
// submits it and the artifact lands in app_config. Opens instantly if a prior run is stored.
export default function PeerCompModal({ onClose }: { onClose: () => void }) {
  const { jobs, bump, refresh } = useAgentQueue();
  const [data, setData] = useState<PeerComp | null | undefined>(undefined); // undefined = loading GET
  const [queuing, setQueuing] = useState(false); // optimistic: clicked → job not yet in the polled queue
  const [error, setError] = useState<string | null>(null);

  // The live peer-comp job (if any). Present in the queue = queued or wip; gone = drained (done).
  const job = jobs.find((j) => j.type === "peer-comp");
  const pending = !!job || queuing;
  const working = job?.status === "wip";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadStored = useCallback(async () => {
    try {
      const d = await fetch("/api/peer-comp").then((r) => r.json());
      setData(d.peerComp ?? null);
    } catch {
      setData((prev) => prev ?? null);
    }
  }, []);

  const generate = useCallback(async () => {
    setError(null);
    setQueuing(true);
    try {
      const r = await fetch("/api/peer-comp", { method: "POST" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "Couldn't queue the comparison.");
        setQueuing(false);
        return;
      }
      bump(); // handed work to the agent — pulse + re-read the queue so the job shows up
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setQueuing(false);
    }
  }, [bump]);

  // Initial load: show the last stored comparison. Don't auto-generate — generating is now an async
  // The agent job the user opts into with the button.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    loadStored();
  }, [loadStored]);

  // Clear the optimistic flag once the queued job actually appears in the polled queue.
  useEffect(() => {
    // Clear the optimistic flag once the real job shows up in the polled queue — a one-shot
    // reconcile with external state, not a render-driving loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (job) setQueuing(false);
  }, [job]);

  // While a job is outstanding, poll the queue faster than the provider's 25s so we notice the drain
  // promptly; on the drain (job present → gone) re-read the stored artifact.
  const wasPending = useRef(false);
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      const iv = setInterval(refresh, 4_000);
      return () => clearInterval(iv);
    }
    if (wasPending.current) {
      wasPending.current = false;
      loadStored(); // The agent drained the job — pull the freshly-stored comparison
    }
  }, [pending, refresh, loadStored]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
          <Coins size={15} className="shrink-0 text-violet-300" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-zinc-200">Peer comp comparison</div>
            <div className="truncate text-[11px] text-zinc-500">Every role you&apos;re actively interviewing for, from your notes · JD · emails.</div>
          </div>
          <button
            onClick={generate}
            disabled={pending}
            title="Queue the agent to (re)build the comparison from your latest notes, JD, and emails"
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-violet-500/90 px-2.5 py-1 text-[13px] font-medium text-violet-950 transition hover:bg-violet-400 disabled:opacity-50"
          >
            {pending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {pending ? (working ? "Working…" : "Queued…") : data ? "Regenerate" : "Generate"}
          </button>
          <button onClick={onClose} title="Close (Esc)" className="shrink-0 text-zinc-500 transition hover:text-zinc-200"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {error && (
            <div className="mb-3 text-[13px] text-rose-300">
              {error}
              <button onClick={generate} className="ml-2 underline hover:text-rose-200">retry</button>
            </div>
          )}
          {pending && (
            <div className="mb-3 flex items-center gap-2 text-[13px] text-zinc-400">
              <Loader2 size={14} className="animate-spin text-violet-300" />
              {working
                ? "the agent is reading your notes, JDs, and recruiter emails and researching comp…"
                : "Queued in the agent — it will build the comparison from your notes, JDs, and emails."}
            </div>
          )}
          {data === undefined ? (
            <div className="flex items-center gap-2 text-[13px] text-zinc-500"><Loader2 size={14} className="animate-spin" /> loading…</div>
          ) : data ? (
            <>
              <article className="prose-instructions">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.markdown}</ReactMarkdown>
              </article>
              <p className="mt-3 text-[11px] text-zinc-600">generated {data.generatedAt.slice(0, 16).replace("T", " ")}</p>
            </>
          ) : (
            !pending && <p className="text-[13px] text-zinc-500">No comparison yet — click <span className="text-zinc-300">Generate</span> to have the agent build one across your active interviewing roles.</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
