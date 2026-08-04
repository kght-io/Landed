"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Activity, AlertTriangle, Bot, HardDrive, Inbox, ListChecks, RefreshCw } from "lucide-react";
import { ago, fmtTs } from "@landed/shared/format/time";
import { fmtBytes } from "@landed/shared/format/bytes";
import type { OpsTone } from "@landed/shared/format/ops";
import type { OpsSnapshot, OpsFile } from "@landed/backend/db/ops";
import type { AgentRunFile } from "@landed/backend/agents/run-log";

type Ops = OpsSnapshot & { agents: AgentRunFile[]; storage: OpsFile[] };

const DOT: Record<OpsTone, string> = {
  good: "bg-emerald-500", warning: "bg-amber-500", critical: "bg-rose-500", neutral: "bg-zinc-500",
};
const TEXT: Record<OpsTone, string> = {
  good: "text-emerald-300", warning: "text-amber-300", critical: "text-rose-300", neutral: "text-zinc-400",
};
const HEADLINE: Record<OpsTone, string> = {
  good: "Everything is running",
  warning: "Needs a look",
  critical: "Something is broken",
  neutral: "Nothing to report",
};


// Duration, not a timestamp — "how long has this been waiting".
const fmtDuration = (ms: number | null) => {
  if (ms === null) return "—";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
};

// The polling cadence is deliberately slow: this page answers "is it stuck", and a stuck queue is
// still stuck 30 seconds later. Anything faster just burns the dev server's rebuild budget.
const REFRESH_MS = 30_000;

export default function OpsView() {
  const [d, setD] = useState<Ops | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  // Fetching and the "refreshing" spinner are separate on purpose. The poll must not touch state
  // synchronously — a setState in an effect body cascades renders (react-hooks flags it) — so the
  // effect awaits this, and only the manual button drives `busy`. The first load already reads as
  // loading via `!d`, so it needs no spinner of its own.
  const fetchOps = useCallback(async () => {
    try {
      const j = await (await fetch("/api/ops")).json();
      if (j.error) setErr(true);
      else { setD(j); setErr(false); }
    } catch {
      setErr(true);
    }
  }, []);

  const refresh = useCallback(() => {
    setBusy(true);
    fetchOps().finally(() => setBusy(false));
  }, [fetchOps]);

  // Start polling. The first tick is scheduled rather than called inline: invoking it in the effect
  // body puts a setState on the synchronous render path (react-hooks/set-state-in-effect), which is
  // the cascading-render footgun the rule exists to catch.
  useEffect(() => {
    const first = setTimeout(fetchOps, 0);
    const t = setInterval(fetchOps, REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [fetchOps]);

  return (
    <div className="flex h-full flex-col text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/80 px-6 py-3.5 backdrop-blur">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">Ops</h1>
          <p className="mt-0.5 text-[13px] text-zinc-500">
            Is the machine running the job search alive — the queue, the agents, and the disk.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1.5 text-[12px] text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
        >
          <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Refresh
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto w-full max-w-5xl">
          {err ? (
            <p className="py-16 text-center text-[13px] text-rose-300">Couldn’t load ops status.</p>
          ) : !d ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
              <Loader2 size={16} className="animate-spin" /> loading…
            </div>
          ) : (
            <div className="space-y-6">
              {/* Headline — the worst signal wins, so a green banner means genuinely nothing is wrong. */}
              <div className="flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-4 py-3.5">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[d.health]}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-[14px] font-medium ${TEXT[d.health]}`}>{HEADLINE[d.health]}</p>
                  <p className="mt-0.5 text-[12px] text-zinc-500">checked {ago(d.generatedAt)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label="Waiting" value={d.queue.queued} sub={d.queue.oldestQueuedAgeMs !== null ? `oldest ${fmtDuration(d.queue.oldestQueuedAgeMs)}` : "queue empty"} tone={d.queue.tone} />
                <Tile label="In flight" value={d.queue.wip} sub="claimed by an agent" />
                <Tile label="Failed" value={d.queue.failed} sub={d.queue.failed ? "needs a look" : "none"} tone={d.queue.failed ? "warning" : "good"} />
                <Tile label="Completed" value={d.queue.ingested} sub="all time" />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card title="Inbox sync" icon={<Inbox size={14} className="text-sky-300" />}>
                  <div className="flex items-baseline gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[d.inboxSync.tone]}`} />
                    <span className={`text-[13px] ${TEXT[d.inboxSync.tone]}`}>
                      {d.inboxSync.lastSyncedAt ? `synced ${ago(d.inboxSync.lastSyncedAt)}` : "never synced"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12px] text-zinc-500">{fmtTs(d.inboxSync.lastSyncedAt)}</p>
                </Card>

                <Card title="Outstanding by type" icon={<ListChecks size={14} className="text-violet-300" />}>
                  {d.byType.length === 0 ? (
                    <Empty>Nothing queued — every job type is drained.</Empty>
                  ) : (
                    <ul className="space-y-1.5">
                      {d.byType.map((t) => (
                        <li key={t.type} className="flex items-center justify-between gap-3 text-[13px]">
                          <span className="truncate font-mono text-[12px] text-zinc-300">{t.type}</span>
                          <span className="flex shrink-0 items-center gap-2 text-[12px] text-zinc-500">
                            {t.queued > 0 && <span>{t.queued} waiting</span>}
                            {t.wip > 0 && <span className="text-sky-300">{t.wip} running</span>}
                            {t.failed > 0 && <span className="text-rose-300">{t.failed} failed</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              <Card title="Recent failures" icon={<AlertTriangle size={14} className="text-rose-300" />}>
                {d.failures.length === 0 ? (
                  <Empty>No failed jobs.</Empty>
                ) : (
                  <ul className="divide-y divide-zinc-800/60">
                    {d.failures.map((f) => (
                      <li key={f.id} className="py-2 first:pt-0 last:pb-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-mono text-[12px] text-zinc-300">{f.type}</span>
                          <span className="shrink-0 text-[11px] text-zinc-600">
                            {ago(f.createdAt)}{f.attempts > 0 && ` · ${f.attempts} attempt${f.attempts === 1 ? "" : "s"}`}
                          </span>
                        </div>
                        {f.error && <p className="mt-1 truncate text-[12px] text-rose-300/80" title={f.error}>{f.error}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card title="Agent runs" icon={<Bot size={14} className="text-emerald-300" />}>
                  {d.agents.length === 0 ? (
                    <Empty>No agent has run yet.</Empty>
                  ) : (
                    <ul className="space-y-1.5">
                      {d.agents.map((a) => (
                        <li key={a.type} className="flex items-center justify-between gap-3 text-[13px]">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.live ? "bg-emerald-500" : "bg-zinc-600"}`} />
                            <span className="truncate font-mono text-[12px] text-zinc-300">{a.type}</span>
                          </span>
                          <span className="shrink-0 text-[12px] text-zinc-500">
                            {a.live ? <span className="text-emerald-300">running</span> : ago(a.lastRunAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card title="Disk" icon={<HardDrive size={14} className="text-amber-300" />}>
                  {d.storage.length === 0 ? (
                    <Empty>Nothing on disk yet.</Empty>
                  ) : (
                    <ul className="space-y-1.5">
                      {d.storage.map((f) => (
                        <li key={f.path} className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="min-w-0">
                            <span className="block truncate text-zinc-300">{f.label}</span>
                            {f.note && <span className="text-[11px] text-zinc-600">{f.note}</span>}
                          </span>
                          <span className="shrink-0 font-mono text-[12px] text-zinc-400">{fmtBytes(f.bytes)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: OpsTone }) {
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
        {tone && <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />}
        {label}
      </p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums text-zinc-100">{value}</p>
      {sub && <p className="text-[11px] text-zinc-600">{sub}</p>}
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-zinc-400">
        {icon} {title}
      </h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="flex items-center gap-1.5 text-[12px] text-zinc-600"><Activity size={12} /> {children}</p>
);
