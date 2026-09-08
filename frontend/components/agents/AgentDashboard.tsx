"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ChevronDown, Check } from "lucide-react";
import type { AgentRunMetrics, Period, RunBucket } from "@landed/shared/agents/run-metrics";

// Per-agent run telemetry, overlaid so agents can be compared: is tailoring getting slower, is fit
// getting more expensive, which of them is failing.
//
// None of this is answerable from the run journals — they hold ONE run per agent type and are
// truncated on the next launch. It reads `agent_run_metrics`, which keeps the CLI's final result
// frame for every run.

type Dashboard = {
  type: string;
  period: Period;
  runs: AgentRunMetrics[];
  trend: RunBucket[];
  totals: { runs: number; failed: number; costUsd: number };
};

const PERIODS: Period[] = ["day", "week", "month"];
const DAYS: Record<Period, number> = { day: 14, week: 84, month: 365 };

// The three that carry the volume — what you'd want on screen without picking.
const DEFAULT_TYPES = ["tailoring", "fit", "watchlist-scan"];

// Categorical slots in FIXED order, assigned by position and never cycled. Validated against the
// light chart surface: lightness band, chroma floor, CVD separation (worst adjacent ΔE 9.1 protan)
// and normal-vision floor (19.6) all pass. Three of them sit under 3:1 contrast, which obligates
// visible labels — the legend below is direct-labelled for exactly that reason.
//
// Capped at eight on purpose: a ninth series would need a generated hue, which is what makes a
// palette stop being distinguishable. The API caps the request to match.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

const fmtDur = (ms: number | null) => (ms == null ? "—" : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 60_000).toFixed(1)}m`);
const fmtTok = (n: number | null) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

type Series = { type: string; label: string; color: string; points: (number | null)[] };

// One measure, one chart. Duration and tokens are different scales, so they never share an axis —
// a second y-scale is the one thing that makes a chart actively lie about which line is bigger.
//
// Lines with markers rather than bars: several agents at once, and the buckets are gappy (an agent
// doesn't run every day). A marker says "there was a run here"; the line between two markers is the
// comparison. Bars would be unreadable grouped five deep.
function TrendChart({ title, keys, series, format }: { title: string; keys: string[]; series: Series[]; format: (n: number | null) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points).filter((v): v is number => v != null);
  const max = all.length ? Math.max(...all) : 0;

  const W = 100; // viewBox units — the SVG scales to its container
  const H = 40;
  const x = (i: number) => (keys.length === 1 ? W / 2 : (i / (keys.length - 1)) * W);
  const y = (v: number) => H - (max ? (v / max) * (H - 4) : 0) - 2;

  if (!keys.length || !max) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        <h4 className="text-[12px] font-medium text-zinc-400">{title}</h4>
        <p className="mt-8 text-center text-[12px] text-zinc-600">no runs in this window</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
      <div className="flex items-baseline justify-between">
        <h4 className="text-[12px] font-medium text-zinc-400">{title}</h4>
        <span className="tabular-nums text-[11px] text-zinc-600">{hover != null ? keys[hover] : `peak ${format(max)}`}</span>
      </div>

      <div className="relative mt-3">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-28 w-full overflow-visible">
          {series.map((s) => {
            // Break the path at gaps so a missing bucket reads as absence, not as a straight line
            // drawn through days the agent never ran.
            const segs: string[] = [];
            let cur: string[] = [];
            s.points.forEach((v, i) => {
              if (v == null) { if (cur.length) segs.push(cur.join(" ")); cur = []; return; }
              cur.push(`${cur.length ? "L" : "M"}${x(i)},${y(v)}`);
            });
            if (cur.length) segs.push(cur.join(" "));
            return (
              <g key={s.type}>
                {segs.map((d, i) => (
                  <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={0.8} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                ))}
                {s.points.map((v, i) =>
                  v == null ? null : (
                    <circle
                      key={i}
                      cx={x(i)}
                      cy={y(v)}
                      r={hover === i ? 1.6 : 1}
                      fill={s.color}
                      // A surface-coloured ring so overlapping markers stay separable.
                      stroke="#fcfcfb"
                      strokeWidth={0.4}
                    />
                  ),
                )}
              </g>
            );
          })}
        </svg>

        {/* Hit targets are full-height columns, far bigger than the markers they select. */}
        <div className="absolute inset-0 flex">
          {keys.map((k, i) => (
            <button key={k} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="flex-1 cursor-default" aria-label={k} />
          ))}
        </div>
      </div>

      {/* Values for the hovered bucket — the tooltip, inline so it never covers the plot. */}
      <div className="mt-2 space-y-0.5">
        {series.map((s) => (
          <div key={s.type} className="flex items-center gap-1.5 text-[11px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.color }} />
            {/* Label in text ink, never the series colour — the swatch carries identity. */}
            <span className="min-w-0 flex-1 truncate text-zinc-500">{s.label}</span>
            <span className="shrink-0 tabular-nums text-zinc-400">
              {format(hover != null ? s.points[hover] : (s.points.filter((v): v is number => v != null).at(-1) ?? null))}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-zinc-600">
        <span>{keys[0]}</span>
        {keys.length > 1 && <span>{keys[keys.length - 1]}</span>}
      </div>
    </div>
  );
}

function AgentPicker({ all, selected, onToggle, titleOf }: { all: string[]; selected: string[]; onToggle: (t: string) => void; titleOf: (t: string) => string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1.5 text-[12px] font-medium text-zinc-300 transition hover:bg-zinc-900"
      >
        {selected.length === 1 ? titleOf(selected[0]) : `${selected.length} agents`}
        <ChevronDown size={13} className="text-zinc-500" />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 min-w-52 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
          {all.map((t) => {
            const on = selected.includes(t);
            // Colour follows the ENTITY, not its rank in the current selection — so deselecting one
            // agent never repaints the others.
            const color = SERIES[all.indexOf(t) % SERIES.length];
            return (
              <button
                key={t}
                onClick={() => onToggle(t)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-zinc-300 transition hover:bg-zinc-800"
              >
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {on && <Check size={12} className="text-emerald-300" />}
                </span>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color, opacity: on ? 1 : 0.3 }} />
                <span className="min-w-0 flex-1 truncate">{titleOf(t)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AgentDashboard({ types, titleOf }: { types: string[]; titleOf: (t: string) => string }) {
  const [period, setPeriod] = useState<Period>("day");
  const [selected, setSelected] = useState<string[]>([]);
  const [data, setData] = useState<Dashboard[] | null>(null);
  const [failedLoad, setFailedLoad] = useState(false);

  // Default to the high-volume agents, intersected with what actually has telemetry.
  const active = selected.length ? selected : types.filter((t) => DEFAULT_TYPES.includes(t));
  const key = active.join(",");

  const load = useCallback(() => {
    // Returning without touching state: a synchronous setState in an effect body triggers the
    // cascading render the react-hooks rule guards against. The "nothing selected" case is handled
    // at render instead, where it's derived from `key` rather than mirrored into state.
    if (!key) return;
    // No setLoading here: a synchronous setState in an effect body triggers the cascading render the
    // react-hooks rule guards against. Staleness is derived from the response instead.
    fetch(`/api/agents/metrics?type=${encodeURIComponent(key)}&period=${period}&days=${DAYS[period]}`)
      .then((r) => r.json())
      .then((d) => { setFailedLoad(!!d.error); setData(d.error ? null : (d.agents ?? [])); })
      .catch(() => setFailedLoad(true));
  }, [key, period]);

  useEffect(() => { load(); }, [load]);

  const stale = !!key && (!data || data.map((d) => d.type).join(",") !== key || (data[0] && data[0].period !== period));

  // A shared x-axis across every selected agent — the union of their buckets, so one agent that ran
  // on a day another didn't still lines up.
  const keys = [...new Set((data ?? []).flatMap((d) => d.trend.map((b) => b.key)))].sort();
  const seriesFor = (pick: (b: RunBucket) => number | null): Series[] =>
    (data ?? []).map((d) => {
      const by = new Map(d.trend.map((b) => [b.key, b]));
      return {
        type: d.type,
        label: titleOf(d.type),
        color: SERIES[types.indexOf(d.type) % SERIES.length],
        points: keys.map((k) => { const b = by.get(k); return b ? pick(b) : null; }),
      };
    });

  const totalRuns = (data ?? []).reduce((n, d) => n + d.totals.runs, 0);
  const totalFailed = (data ?? []).reduce((n, d) => n + d.totals.failed, 0);
  const totalCost = (data ?? []).reduce((n, d) => n + d.totals.costUsd, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-zinc-400">Run telemetry</h2>
        <AgentPicker
          all={types}
          selected={active}
          titleOf={titleOf}
          onToggle={(t) =>
            setSelected((cur) => {
              const base = cur.length ? cur : active;
              const next = base.includes(t) ? base.filter((x) => x !== t) : [...base, t];
              return next.length ? next : base; // never empty — an empty chart says nothing
            })
          }
        />
        {data && totalRuns > 0 && (
          <span className="flex items-center gap-3 text-[12px] text-zinc-500">
            <span className="tabular-nums">{totalRuns} runs</span>
            {totalFailed > 0 && <span className="tabular-nums text-[#e34948]">{totalFailed} failed</span>}
            <span className="tabular-nums">{fmtUsd(totalCost)}</span>
          </span>
        )}
        {/* One period control for both charts. */}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-zinc-800 p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-2 py-1 text-[12px] font-medium capitalize transition ${
                period === p ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {stale && !failedLoad ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-zinc-500">
          <Loader2 size={14} className="animate-spin" /> loading…
        </div>
      ) : !key || !data || !totalRuns ? (
        <p className="py-8 text-center text-[13px] text-zinc-500">
          No runs recorded yet. Telemetry is kept from the moment a run finishes — it fills in as agents work.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <TrendChart title="Time per run (successful)" keys={keys} series={seriesFor((b) => b.avgDurationMs)} format={fmtDur} />
          <TrendChart title="Output tokens per run" keys={keys} series={seriesFor((b) => b.avgOutputTokens)} format={fmtTok} />
        </div>
      )}
    </div>
  );
}
