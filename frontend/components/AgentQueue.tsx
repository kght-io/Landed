"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, X, Loader2, Check, Clock } from "lucide-react";
import { jobSubject, KILL_CONFIRM, actorLabel } from "@/components/jobMeta";
import { QUEUE_CLEARED_EVENT } from "@/components/AgentQueueProvider";
import { ago } from "@landed/shared/format";

type Job = {
  id: string;
  type: string;
  status: string; // queued | wip | ingested
  createdAt: string;
  createdBy: string;
  claimedAt?: string | null;
  claimedBy?: string | null;
  ingestedAt?: string | null;
  summary?: string | null;
  params?: Record<string, unknown>;
};

const HOUR_MS = 3_600_000;
// How long a Done job lingers after completion before dropping off. Fit runs in bursts, so keep its
// finished jobs visible for a full day; other types clear after an hour.
const doneRetentionMs = (type: string) => (type === "fit" ? 24 * HOUR_MS : HOUR_MS);

// One agent's jobs in a single list, each tagged In progress / Queued / Done — newest-added first
// (descending by added order). Done jobs linger after completion so you can see what just finished,
// then drop off (see doneRetentionMs). Self-contained (polls /api/jobs incl. ingested) and shared by
// the floating panel + the agent's split view.
export default function AgentQueue({ type }: { type: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topIdRef = useRef<string | null>(null);

  const apply = useCallback((d: { jobs?: Job[] }) => {
    const cutoff = Date.now() - doneRetentionMs(type);
    const mine = (d.jobs ?? [])
      .filter((j) => j.type === type && (j.status !== "ingested" || Date.parse(j.ingestedAt ?? j.createdAt) >= cutoff))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first (descending by added order)
    setJobs(mine);
  }, [type]);

  const load = useCallback(() => {
    fetch("/api/jobs?status=queued,wip,ingested").then((r) => r.json()).then(apply).catch(() => {});
  }, [apply]);

  useEffect(() => {
    let alive = true;
    const pull = () => fetch("/api/jobs?status=queued,wip,ingested").then((r) => r.json()).then((d) => { if (alive) apply(d); }).catch(() => {});
    pull();
    const iv = setInterval(pull, 10_000);
    // Clear pressed → drop this agent's queued rows right now (keep in-flight wip + done); the poll reconciles.
    const onCleared = (e: Event) => {
      const t = (e as CustomEvent).detail?.type;
      if (t && t !== type) return;
      setJobs((js) => js.filter((j) => j.status !== "queued"));
    };
    window.addEventListener(QUEUE_CLEARED_EVENT, onCleared);
    return () => { alive = false; clearInterval(iv); window.removeEventListener(QUEUE_CLEARED_EVENT, onCleared); };
  }, [apply, type]);

  // Keep the newest (top) in view: snap to the top whenever a new job appears at the head.
  useEffect(() => {
    const top = jobs[0]?.id ?? null;
    if (top !== topIdRef.current) {
      topIdRef.current = top;
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  }, [jobs]);

  const remove = async (id: string) => {
    await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    load();
  };
  const requeue = async (id: string) => {
    if (!confirm(KILL_CONFIRM)) return;
    await fetch(`/api/jobs/${encodeURIComponent(id)}/requeue`, { method: "POST" }).catch(() => {});
    load();
  };

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      {jobs.length === 0 ? (
        <p className="px-4 py-8 text-center text-[12px] text-zinc-600">Nothing in the last {type === "fit" ? "24 hours" : "hour"}.</p>
      ) : (
        <div className="divide-y divide-zinc-800/40">
          {jobs.map((j) => <QueueRow key={j.id} j={j} remove={remove} requeue={requeue} />)}
        </div>
      )}
    </div>
  );
}

function QueueRow({ j, remove, requeue }: { j: Job; remove: (id: string) => void; requeue: (id: string) => void }) {
  const meta =
    j.status === "wip" ? `claimed ${ago(j.claimedAt ?? j.createdAt)} by ${j.claimedBy ? actorLabel(j.claimedBy) : "agent"}`
    : j.status === "ingested" ? `done ${ago(j.ingestedAt ?? j.createdAt)}${j.summary ? ` · ${j.summary}` : ""}`
    : `queued ${ago(j.createdAt)} by ${actorLabel(j.createdBy)}`;
  return (
    <div className="group flex items-center gap-2.5 px-4 py-2.5 hover:bg-zinc-800/40">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-zinc-200">{jobSubject(j) ?? "all postings"}</p>
        <p className="truncate text-[11px] text-zinc-600">{meta}</p>
      </div>
      <StatusTag status={j.status} />
      {j.status === "wip" ? (
        <button onClick={() => requeue(j.id)} title="Run died? Force this stuck job back to the queue" className="shrink-0 text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:text-rose-300"><RotateCcw size={14} /></button>
      ) : j.status === "queued" ? (
        <button onClick={() => remove(j.id)} title="Remove from queue" className="shrink-0 text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:text-rose-300"><X size={14} /></button>
      ) : (
        <span className="w-[14px] shrink-0" /> // keep rows aligned for done jobs (no action)
      )}
    </div>
  );
}

function StatusTag({ status }: { status: string }) {
  if (status === "wip")
    return <span className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-sky-300 bg-sky-500/15"><Loader2 size={10} className="animate-spin" /> In progress</span>;
  if (status === "ingested")
    return <span className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 bg-emerald-500/15"><Check size={10} /> Done</span>;
  return <span className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-orange-300 bg-orange-500/15"><Clock size={10} /> Queued</span>;
}
