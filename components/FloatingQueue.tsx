"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, X, ArrowRight, Play, Square, CheckCircle2 } from "lucide-react";
import { useAgentQueue, QUEUE_CLEARED_EVENT } from "@/components/AgentQueueProvider";
import { useAgentChats } from "@/components/AgentChatsProvider";
import { loadTone, loadHint, hasWip, wipBlink, agentColor } from "@/components/jobMeta";
import { personaFor } from "@/lib/agents/personas";
import AgentQueue from "@/components/AgentQueue";

// Group queued jobs by type, preserving newest-first order (so the just-added type floats up).
function groupByType<T extends { type: string }>(items: T[]): [string, T[]][] {
  const g = new Map<string, T[]>();
  for (const it of items) (g.get(it.type) ?? g.set(it.type, []).get(it.type)!).push(it);
  return [...g.entries()];
}

// Bottom-right floating the agent queue: a count badge that pops when you hand off work (from the
// discovery funnel), a popover of the most recent queued jobs (removable), and a link to the full
// Agents page. Pure notification surface — jobs are added contextually, not here. Mounted once in
// the layout, backed by the shared queue context.
export default function FloatingQueue() {
  const { jobs, count, pulse } = useAgentQueue();
  const [open, setOpen] = useState(false);
  // Any job an agent has claimed (wip) → an agent is actively working; the Bot icon spins to show it.
  const working = jobs.some((j) => j.status === "wip");

  // "Queue cleared" toasts: when a job type's outstanding count falls from >0 to 0 (an agent drained
  // it), pop a little notification saying how many completed. `peak` tracks the most it held since it
  // was last empty, so a queue drained across several polls still reports the full count.
  const prevCounts = useRef<Record<string, number>>({});
  const peak = useRef<Record<string, number>>({});
  const toastId = useRef(0);
  const [toasts, setToasts] = useState<{ id: number; type: string; n: number }[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  // A queue can also empty because it was CLEARED (jobs deleted), not completed — track which types
  // were just cleared so we suppress the "N completed" toast for those; agent-drained queues still toast.
  const clearedTypes = useRef<Set<string>>(new Set());
  useEffect(() => {
    const onCleared = (e: Event) => {
      const t = (e as CustomEvent).detail?.type;
      if (t) clearedTypes.current.add(t); else clearedTypes.current.add("*");
    };
    window.addEventListener(QUEUE_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(QUEUE_CLEARED_EVENT, onCleared);
  }, []);
  useEffect(() => {
    const cur: Record<string, number> = {};
    for (const j of jobs) cur[j.type] = (cur[j.type] ?? 0) + 1;
    for (const t of new Set([...Object.keys(cur), ...Object.keys(prevCounts.current)])) {
      const c = cur[t] ?? 0;
      const p = prevCounts.current[t] ?? 0;
      if (c > (peak.current[t] ?? 0)) peak.current[t] = c;
      if (p > 0 && c === 0) {
        const clearedManually = clearedTypes.current.delete(t) || clearedTypes.current.delete("*");
        const n = peak.current[t] || p;
        peak.current[t] = 0;
        if (clearedManually) continue; // emptied by a manual clear, not by completion → no toast
        const id = ++toastId.current;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setToasts((ts) => [...ts.slice(-3), { id, type: t, n }]); // keep at most 4 on screen
        setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 6000); // auto-dismiss
      }
    }
    prevCounts.current = cur;
  }, [jobs]);

  // Idle, the icon tucks off the right edge showing only a ~25% sliver; it slides fully into view on
  // hover, while the panel is open, or briefly when a job is queued (pulse). The wrapper reaches the
  // screen edge (right-0 + pr-6) so its hover area covers both the sliver and the revealed button —
  // otherwise the icon would flicker as it slid out from under the cursor.
  const revealed = open || pulse;

  return (
    <div className="group fixed bottom-6 right-0 z-50 flex flex-col items-end gap-3 pr-6">
      {/* Queue-cleared notifications, stacked above the panel + icon. */}
      {toasts.length > 0 && (
        <div className="flex flex-col items-end gap-2">
          {toasts.map((t) => <QueueToast key={t.id} type={t.type} n={t.n} onDismiss={() => dismiss(t.id)} />)}
        </div>
      )}
      {open && <Panel onClose={() => setOpen(false)} jobs={jobs} count={count} />}

      <button
        onClick={() => setOpen((o) => !o)}
        title={working ? "Agent queue — working…" : "Agent queue"}
        className={`relative flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500 text-violet-50 shadow-lg shadow-violet-500/30 ring-1 ring-violet-400/40 transition duration-300 ease-out hover:bg-violet-400 ${pulse ? "scale-110" : "scale-100"} ${working ? "agent-working-box" : ""} ${revealed ? "translate-x-0" : "translate-x-[66px] group-hover:translate-x-0"}`}
      >
        {pulse && <span className="absolute inset-0 animate-ping rounded-2xl bg-violet-400/60" />}
        {/* "the agent is working" indicator (any job in progress): the Bot icon spins slowly while the
            violet box breathes a glow (robot-lab variant 14). */}
        <Bot size={22} strokeWidth={2.2} className={`relative ${working ? "agent-working-icon" : ""}`} />
        {count > 0 && (
          <span className={`absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-[var(--background)] bg-amber-400 px-1 text-[12px] font-bold tabular-nums text-amber-950 transition-transform ${pulse ? "scale-125" : "scale-100"}`}>
            {count}
          </span>
        )}
      </button>
    </div>
  );
}

// A "queue cleared" chat bubble — a violet gradient (matching the robot) with a springy pop-in.
// Click (or the 6s timer) dismisses it.
function QueueToast({ type, n, onDismiss }: { type: string; n: number; onDismiss: () => void }) {
  return (
    <div
      onClick={onDismiss}
      title="Dismiss"
      className="agent-toast-in flex w-80 cursor-pointer items-center gap-3 rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/25 via-zinc-900 to-zinc-900 px-3.5 py-2.5 shadow-2xl shadow-violet-900/40 ring-1 ring-inset ring-violet-400/20 transition hover:from-violet-500/35"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/20">
        <CheckCircle2 size={18} className="text-violet-300" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-zinc-50">{personaFor(type)}</span>
        <span className="block text-[12px]">
          <span className="font-medium text-violet-300">Queue cleared!</span>
          <span className="text-zinc-400"> {n} job{n === 1 ? "" : "s"} completed</span>
        </span>
      </span>
      <X size={14} className="shrink-0 text-zinc-500" />
    </div>
  );
}

function Panel({ jobs, count, onClose }: { jobs: ReturnType<typeof useAgentQueue>["jobs"]; count: number; onClose: () => void }) {
  const groups = groupByType(jobs);
  const [tab, setTab] = useState<string | null>(null);
  // The SAME live agent the Agents page shows (shared provider) — so the floating "Run" and the
  // on-screen robot are one run, not two separate processes.
  const { get, start, stop, setOpen } = useAgentChats();
  // Active agent tab, falling back to the first (and recovering if the active type drains away).
  const active = tab && groups.some(([t]) => t === tab) ? tab : groups[0]?.[0] ?? null;
  const running = active ? get(active).running : false;

  const toggleRun = () => {
    if (!active) return;
    if (running) stop(active);
    else { setOpen(active); start(active); } // open it on the Agents page too, then run
  };

  return (
    <div className="w-80 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-100">
          <Bot size={14} className="text-sky-300" /> Agent queues
          <span className="rounded-full bg-zinc-800 px-1.5 text-[11px] font-bold tabular-nums text-zinc-400">{count}</span>
        </h3>
        <button onClick={onClose} title="Close" className="text-zinc-500 hover:text-zinc-300"><X size={15} /></button>
      </div>

      {groups.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-zinc-600">No agent has work queued — hand off from the funnel.</p>
      ) : (
        <>
          {/* One tab per agent (with work) — colored robot + persona + its queue depth. */}
          <div className="flex gap-1 overflow-x-auto border-b border-zinc-800 px-2 py-2">
            {groups.map(([type, list]) => (
              <button
                key={type}
                onClick={() => setTab(type)}
                title={hasWip(list) ? `${loadHint(list.length)} · working now` : loadHint(list.length)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition ${wipBlink(list)} ${active === type ? "bg-zinc-800 text-zinc-100 ring-1 ring-inset ring-zinc-700" : "text-zinc-400 hover:bg-zinc-800/60"}`}
              >
                <Bot size={12} className={agentColor(type)} /> {personaFor(type)}
                <span className={`rounded-full px-1 text-[11px] font-bold tabular-nums ${loadTone(list.length)}`}>{list.length}</span>
              </button>
            ))}
          </div>

          {/* What the active agent is working on + what's queued (shared with the agent's split view). */}
          <div className="h-72">
            {active && <AgentQueue type={active} />}
          </div>

          <div className="border-t border-zinc-800 bg-zinc-950/40 px-4 py-3">
            <button
              onClick={toggleRun}
              className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium text-white transition ${running ? "bg-rose-600 hover:bg-rose-500" : "bg-sky-600 hover:bg-sky-500"}`}
            >
              {running ? <><Square size={13} /> Stop the {personaFor(active ?? "")}</>
                : <><Play size={13} /> Run the {personaFor(active ?? "")}</>}
            </button>
            <Link href="/agents" onClick={onClose} className="mt-2 flex items-center justify-center gap-1 text-[12px] font-medium text-zinc-400 transition hover:text-sky-300">
              Watch live in Agents <ArrowRight size={12} />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
