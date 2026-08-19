// The agents page, re-laid-out for a window.
//
// The web page stacks collapsible cards down a scrolling column: sensible in a browser tab you
// scroll anyway, wasteful in a fixed window where a chat wants the full height. Here the agents are
// a left rail and the selected one's chat fills the right — so switching agents is one click and the
// transcript never has 32rem imposed on it.
//
// Every control is the WEB PAGE'S OWN component, imported rather than rebuilt: the context meter,
// the Auto pill, the Work-queue/Stop button, and the chat pane itself. This file decides where they
// sit; it does not decide what they do. That is the difference between a re-arrangement and a fork,
// and it is why those four are exported from AgentsLive rather than copied.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Eraser, Server, Wrench, X } from "lucide-react";
import {
  AutoDrainToggle,
  ContextMeter,
  LiveAgentChat,
  WorkQueueButton,
} from "@/components/AgentsLive";
import { useAgentChats } from "@/components/AgentChatsProvider";
import { useAgentQueue } from "@/components/AgentQueueProvider";
import AgentMonitor, { type MonitorJob } from "@/components/agents/AgentMonitor";
import McpDocsPanel from "@/components/mcp/McpDocsPanel";
import Playbook from "@/components/agents/Playbook";
import { personaFor } from "@landed/shared/agents/personas";
import Files from "./Files";

type JobTypeMeta = { type: string; title: string; description: string; playbook: string };
type Pane = { kind: "agent"; type: string } | { kind: "monitor" } | { kind: "mcp" } | { kind: "files" };

export default function Agents() {
  const [types, setTypes] = useState<JobTypeMeta[]>([]);
  const [chosen, setPane] = useState<Pane | null>(null);
  const [playbook, setPlaybook] = useState<{ title: string; path: string } | null>(null);
  const { jobs } = useAgentQueue();
  const { get, clear, setAutoDrain } = useAgentChats();

  // /api/jobs carries the type catalogue alongside the queue — the same one AgentsLive reads, so
  // titles and playbook paths here match the web page exactly rather than being restated.
  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((d: { types?: JobTypeMeta[] }) => setTypes(d.types ?? []))
      .catch(() => setTypes([]));
  }, []);

  const backlog = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const j of jobs) if (j.status === "queued") counts[j.type] = (counts[j.type] ?? 0) + 1;
    return counts;
  }, [jobs]);

  // Failures drive the Monitor badge — the number worth interrupting someone for.
  const failed = useMemo(() => jobs.filter((j) => j.status === "failed"), [jobs]);
  const titleOf = useCallback(
    (type: string) => types.find((t) => t.type === type)?.title ?? type,
    [types],
  );

  // Derived rather than stored: with no explicit choice the first agent is shown, so the right pane
  // is never blank on open and nothing has to be set from an effect once the list arrives.
  const pane: Pane | null = chosen ?? (types.length ? { kind: "agent", type: types[0].type } : null);
  const selected = pane?.kind === "agent" ? pane.type : null;

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/20">
        <p className="px-3 pt-3 pb-2 text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">Agents</p>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
          {types.map((t) => {
            const chat = get(t.type);
            const active = selected === t.type;
            return (
              <div
                key={t.type}
                onClick={() => setPane({ kind: "agent", type: t.type })}
                className={`cursor-pointer rounded-xl border px-2.5 py-2 transition ${
                  active ? "border-zinc-700 bg-zinc-900/70" : "border-transparent hover:bg-zinc-900/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      chat.running ? "animate-pulse bg-emerald-400" : "bg-zinc-700"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{personaFor(t.type)}</span>
                  {backlog[t.type] > 0 && (
                    <span className="shrink-0 rounded-full bg-zinc-800 px-1.5 text-[11px] font-bold tabular-nums text-zinc-300">
                      {backlog[t.type]}
                    </span>
                  )}
                </div>

                {/* The meter stays on every row: context pressure is the one number that predicts a
                    run degrading, and it is worth seeing without clicking in. */}
                <div className="mt-1.5 flex items-center gap-2 pl-4">
                  <ContextMeter tokens={chat.contextTokens} model={chat.model} />
                </div>

                {/* Everything else appears only on the SELECTED agent. Five copies of six controls
                    is thirty controls competing for a 300px column, and you can only act on one
                    agent at a time anyway — so the rail shows state for all and offers actions for
                    the one in front of you. It doubles as the selection cue, which a border alone
                    was carrying. */}
                {active && (
                  <div
                    className="mt-2 flex items-center gap-1 pl-4"
                    onClick={(e) => e.stopPropagation()} // a control click is not a re-selection
                  >
                    <WorkQueueButton type={t.type} />
                    <span className="flex-1" />
                    <AutoDrainToggle on={chat.autoDrain !== false} onChange={(v) => setAutoDrain(t.type, v)} />
                    <button
                      onClick={() => clear(t.type)}
                      disabled={chat.running || (!chat.sessionId && chat.entries.length === 0)}
                      title="Clear this agent's transcript and reset its session"
                      className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-rose-300 disabled:opacity-30"
                    >
                      <Eraser size={13} />
                    </button>
                    <button
                      onClick={() => setPlaybook({ title: personaFor(t.type), path: t.playbook })}
                      title="Instructions (this agent's playbook)"
                      className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      <BookOpen size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* View switches, not agents — separated so the rail's top stays one kind of thing. */}
        <nav className="flex items-center gap-1 border-t border-zinc-800 px-2 py-2">
          {(
            [
              { kind: "monitor", label: "Monitor", icon: <Wrench size={12} />, badge: failed.length },
              { kind: "mcp", label: "MCP", icon: <Server size={12} /> },
              { kind: "files", label: "Files", icon: <BookOpen size={12} /> },
            ] as const
          ).map((v) => (
            <button
              key={v.kind}
              onClick={() => setPane({ kind: v.kind } as Pane)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] transition ${
                pane?.kind === v.kind ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              {v.icon} {v.label}
              {"badge" in v && v.badge ? (
                <span className="rounded-full bg-rose-500/20 px-1.5 text-[10px] font-bold text-rose-300">{v.badge}</span>
              ) : null}
            </button>
          ))}
        </nav>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {playbook ? (
          // Instructions take the pane rather than a modal: a playbook is read alongside the work,
          // and the rail keeps the agent it belongs to visible.
          <>
            <header className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
              <BookOpen size={13} className="text-zinc-500" />
              <p className="flex-1 truncate text-[13px] font-medium">{playbook.title} · instructions</p>
              <button onClick={() => setPlaybook(null)} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
                <X size={14} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
              <Playbook path={playbook.path} fill />
            </div>
          </>
        ) : pane?.kind === "agent" ? (
          <LiveAgentChat key={pane.type} type={pane.type} backlog={backlog[pane.type] ?? 0} />
        ) : pane?.kind === "monitor" ? (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <AgentMonitor jobs={jobs as MonitorJob[]} titleOf={titleOf} />
          </div>
        ) : pane?.kind === "mcp" ? (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <McpDocsPanel />
          </div>
        ) : pane?.kind === "files" ? (
          <div className="min-h-0 flex-1 overflow-hidden p-4">
            <Files />
          </div>
        ) : null}
      </section>
    </div>
  );
}
