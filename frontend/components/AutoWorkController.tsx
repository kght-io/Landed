"use client";

import { useEffect, useRef, useState } from "react";
import { BellOff, Bot, CircleStop, Loader2, X } from "lucide-react";
import { useAgentQueue } from "@/components/AgentQueueProvider";
import { useAgentChats } from "@/components/AgentChatsProvider";
import { usePersistentState } from "@/hooks/usePersistentState";
import { agentColor, jobSubject, jobVerb } from "@/components/jobMeta";
import { personaFor } from "@landed/shared/agents/personas";
import { autoWorkPlan, AUTO_WORK_THRESHOLD } from "@landed/shared/agents/autowork";

// Persisted app-wide so the header toggle (Agents page) and this controller share one source of
// truth (usePersistentState broadcasts writes in-tab). Default ON — a queued job works right away.
export const AUTO_WORK_KEY = "landed.agents.autowork";
// Agent types whose backlog notice the user has already dealt with — ignored it, cancelled jobs from
// it, or stopped the agent. Remembered across reloads: those agents never raise it again.
export const AUTO_WORK_IGNORED_KEY = "landed.agents.autowork.ignored";

// Headless bridge, mounted once in the root layout: watches the live queue and, when a job is
// queued, starts the matching agent to drain it — no manual "Work queue" click. Work is never
// blocked on you. A backlog over AUTO_WORK_THRESHOLD raises the notice below — it says what the
// agent is doing, lists every job so you can cancel the ones you don't want, and offers the brake.
export default function AutoWorkController() {
  const { jobs, remove } = useAgentQueue();
  const { get, start, stop } = useAgentChats();
  const [enabled] = usePersistentState<boolean>(AUTO_WORK_KEY, true);
  const [ignored, setIgnored] = usePersistentState<string[]>(AUTO_WORK_IGNORED_KEY, []);
  // The agent type whose backlog notice is showing (one at a time), or null.
  const [notice, setNotice] = useState<string | null>(null);
  // Read live agent state (running / paused) without making it an effect dep — chats churn every
  // stream frame; we only want to react to QUEUE changes. A ref keeps the read fresh.
  const getRef = useRef(get);
  useEffect(() => { getRef.current = get; }, [get]);
  // Previous per-type queued counts, to detect GROWTH (a new add). null until the first observation,
  // so a queue already long at load establishes a baseline WITHOUT popping a notice on mount.
  const prevByType = useRef<Record<string, number> | null>(null);

  // Reacting to async queue changes (adds/polls) is the intended use here — start idle agents and
  // surface the backlog notice — not a render cascade. The rule is scoped off for this effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!enabled) { setNotice(null); return; }
    // Queued (up-for-grabs) counts per type — wip is already being worked, so it doesn't count.
    const byType: Record<string, number> = {};
    for (const j of jobs) if (j.status === "queued") byType[j.type] = (byType[j.type] ?? 0) + 1;
    const prev = prevByType.current;
    prevByType.current = byType;

    const plan = autoWorkPlan({
      enabled,
      byType,
      running: (t) => !!getRef.current(t).running,
      // Paused agents (manual Stop / "Stop work") stay stopped until re-armed — never auto-start.
      held: (t) => getRef.current(t).autoDrain === false,
      // Grew only relative to a KNOWN prior snapshot; on the first run (prev === null) nothing counts
      // as grown, so a long queue present at load never notifies until a real add bumps it.
      grew: (t) => prev != null && (byType[t] ?? 0) > (prev[t] ?? 0),
      // Already dealt with once → this agent works quietly from now on.
      ignored: (t) => ignored.includes(t),
    });
    for (const t of plan.start) start(t);
    // Show one notice at a time; don't replace the one that's up. It closes itself once this agent
    // has no outstanding work left (queued OR wip) — nothing to report, nothing to cancel.
    setNotice((cur) => {
      if (cur) return jobs.some((j) => j.type === cur) ? cur : null;
      return plan.notify[0] ?? null;
    });
  }, [jobs, enabled, ignored, start]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!notice) return null;
  // Everything outstanding for this agent, the in-flight one first — the live queue, not a snapshot,
  // so the list shrinks as you cancel rows and as the agent drains them.
  const list = jobs.filter((j) => j.type === notice).sort((a, b) => Number(b.status === "wip") - Number(a.status === "wip"));
  if (!list.length) return null; // the effect will clear `notice` on this same queue change
  const persona = personaFor(notice);
  const working = !!get(notice).running;
  const n = list.length;

  // Once you've acted on a notice — any action — this agent stops raising it, for good.
  const dealtWith = () => { if (!ignored.includes(notice)) setIgnored([...ignored, notice]); };
  const close = () => setNotice(null); // X / backdrop: just get out of the way, the agent works on
  const ignore = () => { dealtWith(); setNotice(null); };
  // The brake: kill the live run AND pause this agent's auto-drain, so it stays stopped until you
  // re-arm it with "Work queue". The queued jobs stay queued — stopping isn't cancelling.
  const stopWork = () => { dealtWith(); stop(notice); setNotice(null); };
  // Per-job cancel. Only queued jobs can be dropped; the claimed (wip) one is already being worked.
  const cancel = (id: string) => { dealtWith(); remove(id); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={close}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-zinc-800 px-5 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800"><Bot size={18} className={agentColor(notice)} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-zinc-100">
              {working && <Loader2 size={14} className="shrink-0 animate-spin text-sky-400" />}
              {working ? `Working ${n} job${n === 1 ? "" : "s"}` : `${n} job${n === 1 ? "" : "s"} queued`}
            </h2>
            <p className="mt-0.5 text-[13px] text-zinc-400">
              {working
                ? <>The <span className="text-zinc-200">{persona}</span> is working through {n === 1 ? "it" : "them"} — more than {AUTO_WORK_THRESHOLD} at once. Cancel anything you don&apos;t need.</>
                : <>Queued for the <span className="text-zinc-200">{persona}</span> — more than {AUTO_WORK_THRESHOLD}. Cancel anything you don&apos;t need.</>}
            </p>
          </div>
          <button onClick={close} title="Close — the agent keeps working" className="rounded-lg p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <ul className="space-y-1.5">
            {list.map((j) => (
              <li key={j.id} className="flex items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2 text-[13px]">
                <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">{jobVerb(j.type)}</span>
                <span className="truncate text-zinc-300">{jobSubject(j) ?? <span className="text-zinc-500">—</span>}</span>
                {j.status === "wip" ? (
                  <span title="Already claimed by the agent — can't be cancelled" className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-sky-400">
                    <Loader2 size={11} className="animate-spin" /> in progress
                  </span>
                ) : (
                  <button
                    onClick={() => cancel(j.id)}
                    title="Cancel this job"
                    className="ml-auto shrink-0 rounded p-0.5 text-zinc-600 transition hover:bg-zinc-800 hover:text-rose-400"
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 px-5 py-3">
          <button
            onClick={ignore}
            title={`Let the ${persona} get on with it — and don't raise this again`}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            <BellOff size={13} /> Ignore
          </button>
          <button
            onClick={stopWork}
            title={`Stop the ${persona} — its jobs stay queued until you click “Work queue”`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-1.5 text-[13px] font-medium text-rose-300 transition hover:bg-rose-900/40 hover:text-rose-200"
          >
            <CircleStop size={13} /> Stop work
          </button>
        </div>
      </div>
    </div>
  );
}
