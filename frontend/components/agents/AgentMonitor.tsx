"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, XCircle, Loader2, Clock, ChevronRight } from "lucide-react";
import { ago } from "@landed/shared/format/time";
import { actorLabel } from "@/components/jobMeta";

// One job-ledger row — the durable record of a unit of agent work (the real observability source,
// vs. the deprecated the agent chat threads).
export type MonitorJob = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  claimedAt?: string | null;
  ingestedAt?: string | null;
  attempts?: number;
  error?: string | null;
  summary?: string | null;
  createdBy?: string;
  task?: string | null;
  params?: Record<string, unknown>;
};

const STATUS: Record<string, { label: string; icon: typeof CheckCircle2; cls: string; spin?: boolean }> = {
  ingested: { label: "done", icon: CheckCircle2, cls: "text-emerald-400" },
  failed: { label: "failed", icon: XCircle, cls: "text-rose-400" },
  wip: { label: "in flight", icon: Loader2, cls: "text-sky-400", spin: true },
  queued: { label: "queued", icon: Clock, cls: "text-zinc-500" },
};

// Most-recent activity timestamp for a job (finished, else claimed, else queued).
const tOf = (j: MonitorJob) => j.ingestedAt ?? j.claimedAt ?? j.createdAt;

function fmtDur(j: MonitorJob): string | null {
  if (!j.claimedAt || !j.ingestedAt) return null;
  const s = Math.max(0, Math.round((Date.parse(j.ingestedAt) - Date.parse(j.claimedAt)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export default function AgentMonitor({ jobs, titleOf }: { jobs: MonitorJob[]; titleOf: (type: string) => string }) {
  // Per-agent (job type) rollup, most-recently-active first.
  const health = useMemo(() => {
    const m = new Map<string, MonitorJob[]>();
    for (const j of jobs) (m.get(j.type) ?? m.set(j.type, []).get(j.type)!).push(j);
    return [...m.entries()]
      .map(([type, js]) => {
        const done = js.filter((j) => j.status === "ingested").length;
        const failed = js.filter((j) => j.status === "failed").length;
        const queued = js.filter((j) => j.status === "queued").length;
        const wip = js.filter((j) => j.status === "wip").length;
        const terminal = done + failed;
        const rate = terminal ? Math.round((done / terminal) * 100) : null;
        const last = js.reduce((mx, j) => (tOf(j) > mx ? tOf(j) : mx), "");
        return { type, total: js.length, done, failed, queued, wip, rate, last };
      })
      .sort((a, b) => b.last.localeCompare(a.last));
  }, [jobs]);

  // Recent runs (any terminal/active row), newest activity first.
  const runs = useMemo(() => [...jobs].sort((a, b) => tOf(b).localeCompare(tOf(a))).slice(0, 40), [jobs]);
  const [open, setOpen] = useState<string | null>(null);

  if (!jobs.length) {
    return <p className="rounded-xl border border-dashed border-zinc-800 py-10 text-center text-[13px] text-zinc-600">No agent runs yet — the ledger is empty.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Per-agent health */}
      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-zinc-400">Agent health</h2>
        <div className="overflow-hidden rounded-xl border border-zinc-800/80">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-zinc-800/80 bg-zinc-900/40 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-2 font-semibold">Agent</th>
                <th className="px-3 py-2 text-right font-semibold">Runs</th>
                <th className="px-3 py-2 text-right font-semibold">Success</th>
                <th className="px-3 py-2 text-right font-semibold">Failed</th>
                <th className="px-3 py-2 text-right font-semibold">Active</th>
                <th className="px-4 py-2 text-right font-semibold">Last run</th>
              </tr>
            </thead>
            <tbody>
              {health.map((h) => (
                <tr key={h.type} className="border-b border-zinc-900 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-zinc-200">{titleOf(h.type)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-zinc-400">{h.done + h.failed}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {h.rate == null ? <span className="text-zinc-600">—</span> : <span className={h.rate >= 90 ? "text-emerald-300" : h.rate >= 60 ? "text-amber-300" : "text-rose-300"}>{h.rate}%</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{h.failed ? <span className="text-rose-300">{h.failed}</span> : <span className="text-zinc-600">0</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-zinc-400">{h.queued + h.wip ? `${h.queued + h.wip}` : <span className="text-zinc-600">—</span>}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-500">{h.last ? ago(h.last) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Run history */}
      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-zinc-400">Run history <span className="text-zinc-600">(latest {runs.length})</span></h2>
        <div className="overflow-hidden rounded-xl border border-zinc-800/80">
          {runs.map((j) => {
            const s = STATUS[j.status] ?? STATUS.queued;
            const Icon = s.icon;
            const dur = fmtDur(j);
            const isOpen = open === j.id;
            const detail = j.error ?? j.summary;
            return (
              <div key={j.id} className="border-b border-zinc-900 last:border-0">
                <button onClick={() => setOpen(isOpen ? null : j.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-zinc-900/40">
                  <Icon size={14} className={`shrink-0 ${s.cls} ${s.spin ? "animate-spin" : ""}`} />
                  <span className="w-28 shrink-0 truncate font-medium text-zinc-200">{titleOf(j.type)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-500">{detail ?? <span className="text-zinc-600">{s.label}</span>}</span>
                  {(j.attempts ?? 0) > 1 && <span className="shrink-0 rounded bg-zinc-800 px-1.5 text-[11px] text-amber-300/90">×{j.attempts}</span>}
                  {dur && <span className="shrink-0 text-[12px] tabular-nums text-zinc-600">{dur}</span>}
                  <span className="w-16 shrink-0 text-right text-[12px] text-zinc-500">{ago(tOf(j))}</span>
                  <ChevronRight size={13} className={`shrink-0 text-zinc-600 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                </button>
                {isOpen && (
                  <div className="space-y-2 border-t border-zinc-800/60 bg-zinc-950/40 px-4 py-3 text-[12px]">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-500">
                      <span>id <span className="font-mono text-zinc-400">{j.id}</span></span>
                      <span>by <span className="text-zinc-400">{j.createdBy ? actorLabel(j.createdBy) : "—"}</span></span>
                      <span>status <span className="text-zinc-400">{s.label}</span></span>
                      <span>queued <span className="text-zinc-400">{ago(j.createdAt)}</span></span>
                    </div>
                    {j.error && <p className="rounded bg-rose-500/10 px-2.5 py-1.5 text-rose-200/90">{j.error}</p>}
                    {j.summary && <p className="leading-relaxed text-zinc-400">{j.summary}</p>}
                    {j.task && <p className="whitespace-pre-wrap leading-relaxed text-zinc-500">{j.task}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
