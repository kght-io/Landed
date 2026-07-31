"use client";

import { SHARDING } from "@landed/shared/prep/reference/system-design-data";
import { SectionTitle } from "../ui";

// Sharding strategies cheat sheet: pattern · when · example · risk.
export default function Sharding() {
  return (
    <div>
      <SectionTitle title="Sharding Strategies" sub="Pick a shard key for the access pattern — and name the hot-shard risk." />
      <div className="space-y-2">
        {SHARDING.map((s) => (
          <div key={s.pattern} className="rounded-xl border border-zinc-800/70 bg-zinc-900/30 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[14px] font-semibold text-indigo-300">{s.pattern}</span>
              <span className="text-[13px] text-zinc-500">— {s.when}</span>
            </div>
            <p className="mt-1.5 text-[13px] text-zinc-400"><span className="font-semibold text-zinc-300">Example:</span> {s.example}</p>
            <p className="mt-1 text-[13px] text-rose-300/80"><span className="font-semibold">Risk:</span> {s.risk}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
