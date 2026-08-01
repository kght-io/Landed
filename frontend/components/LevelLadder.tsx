"use client";

import { useState } from "react";
import { BarChart3, Sparkles } from "lucide-react";
import PopoverPanel, { anchorFrom } from "@/components/Popover";
import { useAgentQueue } from "@/components/AgentQueueProvider";
import { DEFAULT_LEVELING_REF, LEVEL_AXIS, hasLadder, straddleRungs, type Leveling, type LevelingRef } from "@landed/shared/config/leveling";

// Reference vs the company, side-by-side on a shared 1–10 axis (both ladders use the same scale, so
// rungs line up vertically). The company's rungs that straddle the reference's target band are
// highlighted — the band the fit step reasons over. The reference (which company, which target
// rung) comes from the configurable LevelingRef.
// One ladder column on the shared 1–10 axis. `pct` maps a rung value to a top-anchored percentage
// (0% = top/low). Hoisted out of LevelLadder so it isn't recreated (and remounted) every render.
function Col({ ladder, titles, highlight, pct }: { ladder: Record<string, [number, number]>; titles?: Record<string, string>; highlight?: Set<string>; pct: (v: number) => number }) {
  return (
    <div className="relative h-56 w-40 rounded-md bg-zinc-950/40 ring-1 ring-inset ring-zinc-800">
      {Object.entries(ladder)
        .sort((a, b) => b[1][1] - a[1][1])
        .map(([lvl, [lo, hi]]) => {
          const title = titles?.[lvl];
          return (
            <div key={lvl} className="absolute inset-x-1 flex items-center" style={{ top: `${pct(lo)}%`, height: `${Math.max(pct(hi) - pct(lo), 7)}%` }}>
              <div className={`flex h-full w-full items-center justify-center gap-1.5 rounded px-1.5 text-[11px] font-medium leading-tight ring-1 ring-inset ${highlight?.has(lvl) ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" : "bg-zinc-800/70 text-zinc-300 ring-zinc-700"}`}>
                <span className="shrink-0 tabular-nums">{lvl}</span>
                {title && <span className="truncate text-[10px] font-normal opacity-80" title={title}>{title}</span>}
              </div>
            </div>
          );
        })}
    </div>
  );
}

export default function LevelLadder({ company, leveling, levelingRef }: { company: string; leveling: Leveling; levelingRef: LevelingRef }) {
  const [MIN, MAX] = LEVEL_AXIS;
  const pct = (v: number) => ((v - MIN) / (MAX - MIN)) * 100; // 0% = top (low) — ascending top→bottom
  const overlap = new Set(straddleRungs(leveling.ladder ?? {}, levelingRef));

  return (
    <div>
      <div className="mb-2 flex gap-3 text-[12px] font-medium">
        <span className="w-40 truncate text-zinc-400">{levelingRef.company}</span>
        <span className="w-40 truncate text-zinc-300">{company}</span>
      </div>
      <div className="flex gap-3">
        <Col ladder={levelingRef.ladder} titles={levelingRef.titles} highlight={new Set([levelingRef.targetBand])} pct={pct} />
        <Col ladder={leveling.ladder ?? {}} titles={leveling.titles} highlight={overlap} pct={pct} />
      </div>
    </div>
  );
}

// Icon trigger for the Assessed/funnel "Lvl" column — click to pop the side-by-side ladder.
// Leveling is fetched lazily (it's the slow, fragile levels.fyi step), so when a company has no
// ladder yet this surfaces a "not fetched" popover with a button that queues a `leveling` job for
// just that company. `source:"none"` = the agent checked and found no ladder → offer a re-check.
export function LevelChip({ company, leveling, levelingRef = DEFAULT_LEVELING_REF }: { company: string; leveling?: Leveling | null; levelingRef?: LevelingRef }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const { add, jobs } = useAgentQueue();
  // Read `source` before the hasLadder guard narrows `leveling` away (source:"none" is still a
  // Leveling, but the guard's false branch drops the whole type).
  const confirmedNone = leveling?.source === "none";
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPos(pos ? null : anchorFrom(e));
  };

  // Has a renderable ladder → the side-by-side chart popover.
  if (hasLadder(leveling)) {
    return (
      <>
        <button onClick={toggle} title={`Levels vs ${levelingRef.company}`} className="text-zinc-500 transition hover:text-sky-300">
          <BarChart3 size={14} />
        </button>
        {pos && (
          <PopoverPanel at={pos} onClose={() => setPos(null)} className="p-3">
            <LevelLadder company={company} leveling={leveling} levelingRef={levelingRef} />
          </PopoverPanel>
        )}
      </>
    );
  }

  // No ladder yet — lazy "fetch leveling" affordance.
  const queued = jobs.some(
    (j) => j.type === "leveling" && String(j.params?.company ?? "").toLowerCase() === company.toLowerCase()
  );
  return (
    <>
      <button
        onClick={toggle}
        title={queued ? "Leveling queued" : confirmedNone ? "No levels.fyi ladder — click to re-check" : "levels.fyi not fetched — click to queue"}
        className={`transition hover:text-sky-300 ${queued ? "text-sky-400" : "text-zinc-700"}`}
      >
        <BarChart3 size={14} className={queued ? "" : "opacity-70"} />
      </button>
      {pos && (
        <PopoverPanel at={pos} onClose={() => setPos(null)} className="w-60 p-3">
          <p className="mb-2 text-[12px] leading-snug text-zinc-400">
            {confirmedNone ? (
              <>No levels.fyi ladder was found for <span className="text-zinc-200">{company}</span>.</>
            ) : (
              <>levels.fyi data not fetched yet for <span className="text-zinc-200">{company}</span>.</>
            )}
          </p>
          {queued ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-sky-300">
              <Sparkles size={12} /> Queued — the agent will fetch it
            </span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); add({ type: "leveling", params: { company } }); setPos(null); }}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-500/15 px-2.5 py-1 text-[12px] font-medium text-sky-300 ring-1 ring-inset ring-sky-500/30 transition hover:bg-sky-500/25"
            >
              <Sparkles size={12} /> {confirmedNone ? "Re-check levels.fyi" : "Queue levels.fyi fetch"}
            </button>
          )}
        </PopoverPanel>
      )}
    </>
  );
}
