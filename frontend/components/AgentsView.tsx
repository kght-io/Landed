"use client";

import { useEffect, useState } from "react";
import { BellOff, Bot, Loader2, ChevronRight, FileText, AlertTriangle, RotateCcw } from "lucide-react";
import { ago } from "@landed/shared/format/time";
import { usePersistentState } from "@/hooks/usePersistentState";
import AgentsLive from "@/components/AgentsLive";
import AgentMonitor, { type MonitorJob } from "@/components/agents/AgentMonitor";
import Playbook from "@/components/agents/Playbook";
import TabBar from "@/components/TabBar";
import McpDocsPanel from "@/components/mcp/McpDocsPanel";
import { AUTO_WORK_IGNORED_KEY, AUTO_WORK_KEY } from "@/components/AutoWorkController";
import { personaFor } from "@landed/shared/agents/personas";

type JobView = MonitorJob;
type JobTypeMeta = { type: string; title: string; description: string; playbook: string };
type InstrFile = { path: string; name: string; group: string };

const guideTitle = (f: InstrFile) =>
  f.name === "README.md" ? "How the agents work" : f.name.replace(/\.md$/, "").replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// Auto-work switch: when ON, a queued job starts its agent right away (no manual "Work queue"). A
// big backlog still asks first (see AutoWorkController). Persisted app-wide via AUTO_WORK_KEY.
function AutoWorkToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      title={on ? "Auto-work: queued jobs start their agent right away (big batches ask first)" : "Auto-work off: drain queues manually with “Work queue”"}
      className="flex shrink-0 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-[12px] font-medium text-zinc-300 transition hover:bg-zinc-900"
    >
      <span className={`relative h-4 w-7 rounded-full transition ${on ? "bg-sky-500" : "bg-zinc-700"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
      Auto-work
    </button>
  );
}

// The only way back from a dealt-with backlog notice (AutoWorkController): those agents work any
// backlog silently from then on, so surface that they're doing it — and let one click un-silence them.
function IgnoredAgentsReset({ types, onReset }: { types: string[]; onReset: () => void }) {
  if (!types.length) return null;
  return (
    <button
      onClick={onReset}
      title={`Working big backlogs silently: ${types.map(personaFor).join(", ")}. Click to be told again.`}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-300"
    >
      <BellOff size={13} /> {types.length} ignored
    </button>
  );
}

// One health metric in the Monitor dashboard strip.
function StatCard({ label, value, tone }: { label: string; value: number; tone: "zinc" | "sky" | "emerald" | "amber" }) {
  const cls = { zinc: "text-zinc-100", sky: "text-sky-300", emerald: "text-emerald-300", amber: "text-amber-300" }[tone];
  const dim = value === 0 && tone !== "zinc";
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${dim ? "text-zinc-600" : cls}`}>{value}</div>
      <div className="mt-0.5 text-[12px] text-zinc-500">{label}</div>
    </div>
  );
}

// The Agents control surface — two views:
//   Chat    — talk to each agent live (AgentsLive); each agent's playbook is in its header.
//   Monitor — observability: run/thread timelines + the job queue, incl. dead-lettered failures.
// (Connections/Gmail moved to the Settings page.)
export default function AgentsView() {
  const [view, setView] = usePersistentState<string>("landed.agents.view", "chat");
  const [autoWork, setAutoWork] = usePersistentState<boolean>(AUTO_WORK_KEY, true);
  const [ignoredAgents, setIgnoredAgents] = usePersistentState<string[]>(AUTO_WORK_IGNORED_KEY, []);
  const [types, setTypes] = useState<JobTypeMeta[]>([]);
  const [playbooks, setPlaybooks] = useState<string[]>([]);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [files, setFiles] = useState<InstrFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [openGuide, setOpenGuide] = useState<string | null>(null);

  async function load() {
    const [d, i] = await Promise.all([
      fetch("/api/jobs").then((r) => r.json()),
      fetch("/api/instructions").then((r) => r.json()),
    ]);
    setTypes(d.types ?? []);
    setPlaybooks(d.playbooks ?? []);
    setJobs(d.jobs ?? []);
    setFiles(i.files ?? []);
    setLoading(false);
  }
  // Fetch-on-mount loader; its setState runs post-await (async), not synchronously, so it doesn't
  // cause the cascading render the rule guards against.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const lastActive = jobs[0]?.createdAt ?? null;
  const titleOf = (type: string) => types.find((t) => t.type === type)?.title ?? type;
  const failed = jobs.filter((j) => j.status === "failed");
  // Monitor health metrics (job-ledger derived).
  const queued = jobs.filter((j) => j.status === "queued").length;
  const wip = jobs.filter((j) => j.status === "wip").length;
  const today = new Date().toISOString().slice(0, 10);
  const doneToday = jobs.filter((j) => j.status === "ingested" && (j.createdAt ?? "").slice(0, 10) === today).length;
  const retry = async (id: string) => {
    await fetch(`/api/jobs/${encodeURIComponent(id)}?action=retry`, { method: "POST" }).catch(() => {});
    load();
  };

  // Guides = every instruction file that isn't a job's own playbook (README, non-agent playbooks).
  // (Per-agent playbooks now live in each agent's header in the Chat view.)
  const jobPlaybooks = new Set(playbooks);
  const guides = files
    .filter((f) => !jobPlaybooks.has(f.path))
    .sort((a, b) => (a.name === "README.md" ? -1 : b.name === "README.md" ? 1 : a.name.localeCompare(b.name)));

  const tabs = [
    { id: "chat", label: "Chat" },
    { id: "monitor", label: failed.length ? `Monitor · ${failed.length}` : "Monitor" },
    { id: "mcp", label: "MCP" },
  ];
  // Normalize to a known tab so a stale persisted value (e.g. the removed "connections") falls back to chat.
  const activeTab = tabs.some((t) => t.id === view) ? view : "chat";

  return (
    <div className="relative flex h-full flex-col text-zinc-100">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-zinc-950/60 text-sm text-zinc-400 backdrop-blur-sm">
          <Loader2 size={16} className="animate-spin" /> loading…
        </div>
      )}

      <header className="px-6 pt-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <Bot size={16} className="text-violet-300" /> Agents
            </h1>
            <p className="mt-0.5 text-[13px] text-zinc-500">
              Live agents that read &amp; write your pipeline over MCP.{lastActive && <> Last active {ago(lastActive)}.</>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <IgnoredAgentsReset types={ignoredAgents} onReset={() => setIgnoredAgents([])} />
            <AutoWorkToggle on={autoWork} onChange={setAutoWork} />
          </div>
        </div>
        <div className="mt-3"><TabBar tabs={tabs} active={activeTab} onChange={setView} /></div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {activeTab === "chat" && (
          <div className="mx-auto max-w-5xl space-y-8">
            <AgentsLive />
            {guides.length > 0 && (
              <section>
                <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-zinc-400">Guides &amp; reference</h2>
                <div className="space-y-2">
                  {guides.map((f) => {
                    const isOpen = openGuide === f.path;
                    return (
                      <div key={f.path} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/30">
                        <button
                          onClick={() => setOpenGuide(isOpen ? null : f.path)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-900/50"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300"><FileText size={15} /></span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{guideTitle(f)}</p>
                            <p className="truncate font-mono text-[12px] text-zinc-600">{f.path}</p>
                          </div>
                          <ChevronRight size={14} className={`shrink-0 text-zinc-500 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                        </button>
                        {isOpen && <Playbook path={f.path} />}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === "mcp" && (
          <div className="mx-auto max-w-3xl">
            <McpDocsPanel />
          </div>
        )}

        {activeTab === "monitor" && (
          <div className="mx-auto max-w-5xl space-y-6">
            {/* Health strip — the at-a-glance state of the agent fleet + queue. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Queued" value={queued} tone="zinc" />
              <StatCard label="In flight" value={wip} tone="sky" />
              <StatCard label="Completed today" value={doneToday} tone="emerald" />
              <StatCard label="Needs attention" value={failed.length} tone="amber" />
            </div>

            {failed.length > 0 && (
              <section>
                <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wider text-amber-300">
                  <AlertTriangle size={13} /> Needs attention <span className="text-zinc-600">({failed.length})</span>
                </h2>
                <div className="space-y-2">
                  {failed.map((j) => (
                    <div key={j.id} className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.04] px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-100">{titleOf(j.type)} <span className="text-[12px] font-normal text-zinc-600">· {j.id}</span></p>
                        <p className="mt-0.5 text-[13px] leading-snug text-amber-200/90">{j.error ?? "failed"}</p>
                        <p className="mt-0.5 text-[12px] text-zinc-600">{j.attempts ?? 0} attempt{(j.attempts ?? 0) === 1 ? "" : "s"} · {ago(j.createdAt)}</p>
                      </div>
                      <button onClick={() => retry(j.id)} title="Re-queue with a fresh attempt budget"
                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1 text-[12px] font-medium text-zinc-200 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-700">
                        <RotateCcw size={12} /> Retry
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <AgentMonitor jobs={jobs} titleOf={titleOf} />
          </div>
        )}
      </div>
    </div>
  );
}
