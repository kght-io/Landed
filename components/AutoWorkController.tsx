"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Play, X } from "lucide-react";
import { useAgentQueue, type QueueJob } from "@/components/AgentQueueProvider";
import { useAgentChats } from "@/components/AgentChatsProvider";
import { usePersistentState } from "@/hooks/usePersistentState";
import { agentColor, jobSubject, jobVerb } from "@/components/jobMeta";
import { personaFor } from "@/lib/agents/personas";
import { autoWorkPlan, AUTO_WORK_THRESHOLD } from "@/lib/agents/autowork";

// Persisted app-wide so the header toggle (Agents page) and this controller share one source of
// truth (usePersistentState broadcasts writes in-tab). Default ON — a queued job works right away.
export const AUTO_WORK_KEY = "landed.agents.autowork";

// Headless bridge, mounted once in the root layout: watches the live queue and, when a job is
// queued, starts the matching agent to drain it — no manual "Work queue" click. The one guardrail is
// token spend: a backlog over AUTO_WORK_THRESHOLD for a type is gated behind a confirm popup (below)
// that shows exactly what would run, so a long/expensive drain is always opted into, never silent.
export default function AutoWorkController() {
  const { jobs } = useAgentQueue();
  const { get, start, setAutoDrain } = useAgentChats();
  const [enabled] = usePersistentState<boolean>(AUTO_WORK_KEY, true);
  // The big-batch confirm currently shown (one type at a time), or null.
  const [confirm, setConfirm] = useState<{ type: string; jobs: QueueJob[] } | null>(null);
  // Read live agent state (running / paused) without making it an effect dep — chats churn every
  // stream frame; we only want to react to QUEUE changes. A ref keeps the read fresh.
  const getRef = useRef(get);
  useEffect(() => { getRef.current = get; }, [get]);
  // Previous per-type queued counts, to detect GROWTH (a new add). null until the first observation,
  // so a queue already long at load establishes a baseline WITHOUT popping a confirm on mount.
  const prevByType = useRef<Record<string, number> | null>(null);

  // Reacting to async queue changes (adds/polls) is the intended use here — start idle agents and
  // surface the big-batch confirm — not a render cascade. The rule is scoped off for this effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!enabled) { setConfirm(null); return; }
    // Queued (up-for-grabs) counts per type — wip is already being worked, so it doesn't count.
    const byType: Record<string, number> = {};
    for (const j of jobs) if (j.status === "queued") byType[j.type] = (byType[j.type] ?? 0) + 1;
    const prev = prevByType.current;
    prevByType.current = byType;

    const plan = autoWorkPlan({
      enabled,
      byType,
      running: (t) => !!getRef.current(t).running,
      // Paused agents (manual Stop / "Not now") stay stopped until re-armed — never auto-start.
      held: (t) => getRef.current(t).autoDrain === false,
      // Grew only relative to a KNOWN prior snapshot; on the first run (prev === null) nothing counts
      // as grown, so a long queue present at load never confirms until a real add bumps it.
      grew: (t) => prev != null && (byType[t] ?? 0) > (prev[t] ?? 0),
    });
    for (const t of plan.start) start(t);
    // Surface one confirm at a time; don't reopen while one is already up.
    setConfirm((cur) => {
      if (cur) return byType[cur.type] ? cur : null; // close if its queue drained out from under it
      const t = plan.confirm[0];
      return t ? { type: t, jobs: jobs.filter((j) => j.type === t && j.status === "queued") } : null;
    });
  }, [jobs, enabled, start]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!confirm) return null;
  const persona = personaFor(confirm.type);
  const n = confirm.jobs.length;
  // "Not now" pauses this agent's auto-drain (like a Stop) so it won't re-prompt or auto-start until
  // you re-arm it. "Work N" starts a drain (which re-arms auto-drain via a fresh Work-queue run).
  const dismiss = () => { setAutoDrain(confirm.type, false); setConfirm(null); };
  const go = () => { start(confirm.type); setConfirm(null); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={dismiss}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-zinc-800 px-5 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800"><Bot size={18} className={agentColor(confirm.type)} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-zinc-100">Work {n} queued job{n === 1 ? "" : "s"}?</h2>
            <p className="mt-0.5 text-[13px] text-zinc-400">
              {n} jobs are queued for the <span className="text-zinc-200">{persona}</span> — more than {AUTO_WORK_THRESHOLD}. Review and confirm.
            </p>
          </div>
          <button onClick={dismiss} className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <ul className="space-y-1.5">
            {confirm.jobs.map((j) => (
              <li key={j.id} className="flex items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2 text-[13px]">
                <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">{jobVerb(j.type)}</span>
                <span className="truncate text-zinc-300">{jobSubject(j) ?? <span className="text-zinc-500">—</span>}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button onClick={dismiss} className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200">Not now</button>
          <button onClick={go} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-sky-500">
            <Play size={13} /> Work {n} job{n === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
