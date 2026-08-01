"use client";

import { useEffect, useState } from "react";
import { Loader2, Briefcase, CalendarDays, GitBranchPlus, Bot, GraduationCap } from "lucide-react";
import { ago } from "@landed/shared/format/time";
import type { DashboardStats, Tone, SeriesPoint, PrepPoint } from "@landed/backend/db/dashboard";

const TONE_BAR: Record<Tone, string> = {
  good: "bg-emerald-500", accent: "bg-sky-500", critical: "bg-rose-500", warning: "bg-amber-500", neutral: "bg-zinc-500",
};
const pct = (f: number) => `${Math.round(f * 100)}%`;

type Range = "week" | "month";

export default function Dashboard() {
  const [d, setD] = useState<DashboardStats | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch("/api/dashboard").then((r) => r.json()).then((j) => (j.error ? setErr(true) : setD(j))).catch(() => setErr(true));
  }, []);

  return (
    <div className="flex h-full flex-col text-zinc-100">
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 px-6 py-3.5 backdrop-blur">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">Dashboard</h1>
        <p className="mt-0.5 text-[13px] text-zinc-500">Your job hunt at a glance — applications, prep, and momentum.</p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto w-full max-w-5xl">
          {err ? (
            <p className="py-16 text-center text-[13px] text-rose-300">Couldn’t load stats.</p>
          ) : !d ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500"><Loader2 size={16} className="animate-spin" /> loading…</div>
          ) : (
            <div className="space-y-6">
              {/* Headline KPIs */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <StatTile label="Applied" value={d.kpis.applied} />
                <StatTile label="Interviews" value={d.kpis.interviewed} tone="accent" />
                <StatTile label="Offers" value={d.kpis.offers} tone="good" />
                <StatTile label="Interview rate" value={pct(d.rates.interview)} sub="of applied" />
                <StatTile label="Active" value={d.kpis.active} sub="in progress" />
                <StatTile label="Watchlist" value={d.kpis.watchlist} sub="companies" />
              </div>

              {/* The three things you check daily — momentum on applications, on prep, and what just happened. */}
              <div className="grid gap-6 lg:grid-cols-3">
                <ApplicationsCard applications={d.applications} />
                <PrepCard prep={d.prep} totals={d.prepTotals} />
                <RecentCard recent={d.recent} />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card title="Pipeline funnel" icon={<GitBranchPlus size={14} className="text-sky-300" />}>
                  <Funnel funnel={d.funnel} />
                </Card>
                <Card title="Application outcomes" icon={<Briefcase size={14} className="text-emerald-300" />}>
                  <Outcomes outcomes={d.outcomes} />
                </Card>
              </div>

              <Card title="Agents" icon={<Bot size={14} className="text-sky-300" />}>
                <MiniStats items={[["Jobs done", d.agent.done], ["Queued", d.agent.queued], ["Working", d.agent.wip]]} />
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: Tone }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "accent" ? "text-sky-300" : "text-zinc-100";
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-600">{sub}</p>}
    </div>
  );
}

function Card({ title, icon, sub, action, children }: { title: string; icon?: React.ReactNode; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-[13px] font-semibold text-zinc-200">{title}</h2>
        {sub && <span className="text-[11px] text-zinc-600">· {sub}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

// Week / month segmented control — sits at the right of a card header.
function RangeToggle({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="ml-auto inline-flex rounded-lg bg-zinc-800/60 p-0.5 text-[11px]">
      {(["week", "month"] as Range[]).map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`rounded-md px-2 py-0.5 font-medium capitalize transition ${value === r ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function ApplicationsCard({ applications }: { applications: DashboardStats["applications"] }) {
  const [range, setRange] = useState<Range>("week");
  const data = applications[range];
  const total = data.reduce((s, p) => s + p.count, 0);
  return (
    <Card title="Applications" icon={<CalendarDays size={14} className="text-sky-300" />} action={<RangeToggle value={range} onChange={setRange} />}>
      <p className="mb-2 text-[12px] text-zinc-500"><span className="text-lg font-semibold tabular-nums text-zinc-100">{total}</span> total · last 12 {range}s</p>
      <BarSeries data={data} unit="application" />
    </Card>
  );
}

function PrepCard({ prep, totals }: { prep: DashboardStats["prep"]; totals: DashboardStats["prepTotals"] }) {
  const [range, setRange] = useState<Range>("week");
  const data = prep[range];
  const lc = data.reduce((s, p) => s + p.leetcode, 0);
  const sd = data.reduce((s, p) => s + p.systemDesign, 0);
  return (
    <Card title="Prep" icon={<GraduationCap size={14} className="text-emerald-300" />} action={<RangeToggle value={range} onChange={setRange} />}>
      <div className="mb-2 flex items-center gap-4 text-[12px]">
        <LegendDot color="bg-emerald-400" label="LeetCode solved" value={lc} />
        <LegendDot color="bg-violet-400" label="System design" value={sd} />
      </div>
      <PrepLines data={data} />
      <p className="mt-2 text-[11px] text-zinc-600">{totals.attempts} total attempts · {totals.companies} companies researched</p>
    </Card>
  );
}

function RecentCard({ recent }: { recent: DashboardStats["recent"] }) {
  return (
    <Card title="Recent activity">
      {recent.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-zinc-600">No activity yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {recent.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px]">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${e.actor === "CoWork" ? "bg-sky-400" : "bg-emerald-400"}`} />
              <span className="min-w-0 flex-1 truncate text-zinc-300" title={e.summary}>{e.summary}</span>
              <span className="shrink-0 text-zinc-600">{ago(e.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
      <span className="text-zinc-400">{label}</span>
      <span className="tabular-nums font-semibold text-zinc-100">{value}</span>
    </span>
  );
}

// Cumulative funnel — magnitude bars scaled to the widest stage, with step conversion %.
function Funnel({ funnel }: { funnel: DashboardStats["funnel"] }) {
  const max = Math.max(1, ...funnel.map((f) => f.count));
  return (
    <div className="space-y-2.5">
      {funnel.map((f, i) => {
        const prev = funnel[i - 1];
        const conv = prev && prev.count ? Math.round((f.count / prev.count) * 100) : null;
        return (
          <div key={f.key} className="flex items-center gap-3">
            <div className="w-20 shrink-0 text-[12px] text-zinc-400">{f.label}</div>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(2, (f.count / max) * 100)}%` }} />
            </div>
            <div className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-100">{f.count}</div>
            <div className="w-12 shrink-0 text-right text-[11px] tabular-nums text-zinc-500">{conv != null ? `${conv}%` : ""}</div>
          </div>
        );
      })}
    </div>
  );
}

// Outcomes — a proportional status bar (2px gaps) + a legend with counts. Status colors, never alone.
function Outcomes({ outcomes }: { outcomes: DashboardStats["outcomes"] }) {
  const total = outcomes.reduce((s, o) => s + o.count, 0);
  const shown = outcomes.filter((o) => o.count > 0);
  return (
    <div>
      {total === 0 ? (
        <p className="py-4 text-center text-[12px] text-zinc-600">No applications yet.</p>
      ) : (
        <>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
            {shown.map((o) => (
              <div key={o.key} className={`h-full ${TONE_BAR[o.tone]}`} style={{ width: `${(o.count / total) * 100}%` }} title={`${o.label}: ${o.count}`} />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
            {outcomes.map((o) => (
              <div key={o.key} className="flex items-center gap-1.5 text-[12px]">
                <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_BAR[o.tone]}`} />
                <span className="min-w-0 flex-1 truncate text-zinc-400">{o.label}</span>
                <span className="tabular-nums text-zinc-200">{o.count}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// A "nice" round axis top ≥ max (1, 2, 5 × 10ⁿ), so counts sit under a clean gridline.
function niceMax(max: number): number {
  if (max <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
// Integer y-axis ticks from 0..top, aiming for ≤3 intervals so a compact chart isn't crowded.
function axisTicks(max: number): { top: number; ticks: number[] } {
  const top = niceMax(max);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => top / s <= 3 && Number.isInteger(top / s)) ?? top;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

// Shared plot area: a fixed-height (h-28) chart with left-hand count labels + horizontal gridlines.
// `children` are absolutely positioned inside the plot and must scale to `top`.
function ChartFrame({ top, ticks, xStart, xEnd, children }: { top: number; ticks: number[]; xStart?: string; xEnd?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex gap-1.5">
        <div className="relative h-28 w-5 shrink-0">
          {ticks.map((t) => (
            <span key={t} style={{ bottom: `${(t / top) * 100}%` }} className="absolute right-0 translate-y-1/2 text-[9px] tabular-nums text-zinc-600">{t}</span>
          ))}
        </div>
        <div className="relative h-28 flex-1">
          {ticks.map((t) => (
            <div key={t} style={{ bottom: `${(t / top) * 100}%` }} className="absolute inset-x-0 border-t border-zinc-800/60" />
          ))}
          {children}
        </div>
      </div>
      {(xStart || xEnd) && (
        <div className="mt-1.5 flex justify-between pl-[26px] text-[10px] tabular-nums text-zinc-600"><span>{xStart}</span><span>{xEnd}</span></div>
      )}
    </div>
  );
}

// Vertical magnitude bars over time, one hue. Bars scale to the axis `top` so they line up with the
// gridlines. (They're DIRECT flex children of a fixed-height row so `height: %` has a definite parent
// — nesting them under a flex-1 wrapper made the parent height content-derived and collapsed them.)
function BarSeries({ data, unit }: { data: SeriesPoint[]; unit: string }) {
  const { top, ticks } = axisTicks(Math.max(1, ...data.map((p) => p.count)));
  return (
    <ChartFrame top={top} ticks={ticks} xStart={data[0]?.label} xEnd={data[data.length - 1]?.label}>
      <div className="absolute inset-0 flex items-end gap-1">
        {data.map((p) => (
          <div
            key={p.key}
            className="min-w-0 flex-1 rounded-t bg-sky-500/80 transition hover:bg-sky-400"
            style={{ height: `${(p.count / top) * 100}%`, minHeight: p.count ? "3px" : "1px" }}
            title={`${p.label}: ${p.count} ${unit}${p.count === 1 ? "" : "s"}`}
          />
        ))}
      </div>
    </ChartFrame>
  );
}

// Two-line time series (leetcode solved + system design practiced). An SVG with a stretched viewBox
// (preserveAspectRatio none) so it fills the card width; strokes stay crisp via non-scaling-stroke.
function PrepLines({ data }: { data: PrepPoint[] }) {
  const { top, ticks } = axisTicks(Math.max(1, ...data.flatMap((p) => [p.leetcode, p.systemDesign])));
  const n = data.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - (v / top) * 100;
  const path = (key: "leetcode" | "systemDesign") =>
    data.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(p[key]).toFixed(2)}`).join(" ");
  return (
    <ChartFrame top={top} ticks={ticks} xStart={data[0]?.label} xEnd={data[data.length - 1]?.label}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label="Prep problems over time">
        <path d={path("systemDesign")} fill="none" stroke="#a78bfa" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d={path("leetcode")} fill="none" stroke="#34d399" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </ChartFrame>
  );
}

function MiniStats({ items }: { items: [string, number][] }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col">
          <span className="text-2xl font-semibold tabular-nums text-zinc-100">{value}</span>
          <span className="text-[12px] text-zinc-400">{label}</span>
        </div>
      ))}
    </div>
  );
}
