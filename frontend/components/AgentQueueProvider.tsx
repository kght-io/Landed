"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// Dispatched on `window` when the queue is cleared (detail.type = one agent, or undefined = all), so
// the separately-polled queue panel + card badge can empty immediately instead of waiting for a poll.
export const QUEUE_CLEARED_EVENT = "landed:queue-cleared";

// A live agent job, as the floating queue + Agents page see it — `queued` (up for grabs) or `wip`
// (an agent claimed it; has claimedAt). Ingested/history rows are excluded.
export type QueueJob = {
  id: string;
  type: string;
  createdBy: string;
  createdAt: string;
  status: string; // queued | wip
  claimedAt?: string | null;
  claimedBy?: string | null;
  task?: string | null;
  params?: Record<string, unknown>;
};

export type AddJobSpec = { type: string; params?: Record<string, unknown>; task?: string };

type QueueCtx = {
  jobs: QueueJob[]; // outstanding (queued + wip), newest first
  count: number;
  inboxLastSynced: string | null; // `inbox_last_synced` watermark (ISO) — last inbox-sync ingest, or null
  pulse: boolean; // transient — drives the "job added" animation on the floating icon
  add: (spec: AddJobSpec) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearQueued: (type?: string) => Promise<void>; // drop queued jobs at once (all, or one agent's by type)
  requeue: (id: string) => Promise<void>; // return a stuck/failed wip job to the queue (manual recovery)
  refresh: () => void; // re-read the queue (after an external add, or to catch the agent draining it)
  bump: () => void; // pulse + refresh — for adds made through other endpoints (e.g. discovery actions)
  // The queued redo note for a posting's phase, or null if no redo is queued. Live (the queue polls
  // + refreshes on delete), so the "Queued for redo" tag + the composer pre-fill clear the moment
  // the job is drained or removed. The note rides on the job params (see enqueueTailoring).
  redoNoteFor: (postingId: string, phase: "fit" | "tailor") => string | null;
  // Whether a posting's fit/tailor job is currently being worked (an agent claimed it → wip). Drives
  // the table's spinning "In progress" status. Live off the same polled queue.
  isWorking: (postingId: string, phase: "fit" | "tailor") => boolean;
  // Whether a posting has an OUTSTANDING fit/tailor job (queued or wip), regardless of its pipeline
  // stage. Lets the table show a "queued" chip for work handed off out of sequence (a re-tailor of an
  // already-tailored row, a re-assess) — decoupled from the posting's status.
  isQueued: (postingId: string, phase: "fit" | "tailor") => boolean;
};

const Ctx = createContext<QueueCtx | null>(null);

// Owns the live the agent queue for the whole app: one fetch, shared by the floating icon and the
// Agents page. Adds optimistically + pulses; polls so the badge shrinks as the agent drains the queue.
export default function AgentQueueProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [inboxLastSynced, setInboxLastSynced] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((d) => {
        setJobs((d.jobs ?? []).filter((j: QueueJob) => j.status === "queued" || j.status === "wip"));
        setInboxLastSynced(d.inboxLastSynced ?? null);
      })
      .catch(() => {});
  }, []);

  // Initial load + a light poll, and a refresh whenever the tab regains focus (the agent may have
  // drained the queue while you were away).
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 25_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  const firePulse = useCallback(() => {
    setPulse(true);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulse(false), 700);
  }, []);

  const add = useCallback(async (spec: AddJobSpec) => {
    firePulse();
    pendo.track("cowork_job_added", {
      job_type: spec.type,
      has_params: !!spec.params,
    });
    try {
      await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(spec) });
    } finally {
      refresh();
    }
  }, [firePulse, refresh]);

  const remove = useCallback(async (id: string) => {
    pendo.track("cowork_job_removed", { job_id: id });
    setJobs((js) => js.filter((j) => j.id !== id)); // optimistic
    try {
      await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    } finally {
      refresh();
    }
  }, [refresh]);

  // Clear the work queue: drop every QUEUED job at once (optionally just one agent's, by type).
  // Leaves in-flight `wip` jobs alone (only queued jobs can be deleted). Optimistic — plus a
  // `queue-cleared` event so the separately-polled queue panel + card badge empty immediately
  // (they don't share this state); the server delete + refresh reconcile behind it.
  const clearQueued = useCallback(async (type?: string) => {
    const ids = jobs.filter((j) => j.status === "queued" && (!type || j.type === type)).map((j) => j.id);
    if (!ids.length) return;
    pendo.track("cowork_queue_cleared", { count: ids.length, type: type ?? "all" });
    setJobs((js) => js.filter((j) => !ids.includes(j.id))); // optimistic (floating queue)
    window.dispatchEvent(new CustomEvent(QUEUE_CLEARED_EVENT, { detail: { type } }));
    try {
      await Promise.all(ids.map((id) => fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" })));
    } finally {
      refresh();
    }
  }, [jobs, refresh]);

  // Manual recovery: an agent claimed a job (wip) but never finished. Return it to `queued` so
  // another agent can pick it up. Optimistic flip; the poll/refresh reconciles.
  const requeue = useCallback(async (id: string) => {
    pendo.track("cowork_job_requeued", { job_id: id });
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, status: "queued", claimedAt: null, claimedBy: null } : j)));
    try {
      await fetch(`/api/jobs/${encodeURIComponent(id)}/requeue`, { method: "POST" });
    } finally {
      refresh();
    }
  }, [refresh]);

  const bump = useCallback(() => { firePulse(); refresh(); }, [firePulse, refresh]);

  const redoNoteFor = useCallback((postingId: string, phase: "fit" | "tailor"): string | null => {
    const id = phase === "tailor" ? `tailoring-app-${postingId}` : `fit-redo-${postingId}`;
    const note = jobs.find((j) => j.id === id)?.params?.redoNote;
    return typeof note === "string" ? note : null;
  }, [jobs]);

  // The live job for a posting's phase (tailor: stable id; fit: the redo id, else any fit job whose
  // params carry this posting). `jobs` holds only outstanding rows (queued + wip).
  const jobFor = useCallback((postingId: string, phase: "fit" | "tailor"): QueueJob | undefined =>
    phase === "tailor"
      ? jobs.find((j) => j.id === `tailoring-app-${postingId}`)
      : jobs.find((j) => j.id === `fit-redo-${postingId}`)
        ?? jobs.find((j) => j.type === "fit" && (j.params?.postings as { id?: unknown }[] | undefined)?.some((p) => String(p?.id) === postingId)),
  [jobs]);
  // Claimed (wip = being worked now) vs merely outstanding (queued or wip).
  const isWorking = useCallback((postingId: string, phase: "fit" | "tailor"): boolean => jobFor(postingId, phase)?.status === "wip", [jobFor]);
  const isQueued = useCallback((postingId: string, phase: "fit" | "tailor"): boolean => !!jobFor(postingId, phase), [jobFor]);

  return (
    <Ctx.Provider value={{ jobs, count: jobs.length, inboxLastSynced, pulse, add, remove, clearQueued, requeue, refresh, bump, redoNoteFor, isWorking, isQueued }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAgentQueue(): QueueCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAgentQueue must be used within AgentQueueProvider");
  return c;
}
