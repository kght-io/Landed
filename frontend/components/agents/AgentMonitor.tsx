"use client";

import { useMemo } from "react";
import { ago } from "@landed/shared/format/time";

// Cross-agent health from the JOB ledger — how much work each agent has, how much of it lands, and
// what's waiting right now.
//
// Deliberately job-grain, which is what makes it complementary to the per-agent run telemetry rather
// than a duplicate of it: one agent RUN drains many JOBS, and a run is only recorded once it ends.
// So "what's queued this second" and "did this unit of work succeed" live here; "how long did the
// process take and what did it spend" lives in AgentDashboard. The run-history list this component
// used to carry was the overlapping half and has been dropped.
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

// Most-recent activity timestamp for a job (finished, else claimed, else queued).
const tOf = (j: MonitorJob) => j.ingestedAt ?? j.claimedAt ?? j.createdAt;

export default function AgentHealth({ jobs, titleOf }: { jobs: MonitorJob[]; titleOf: (type: string) => string }) {
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

    </div>
  );
}
