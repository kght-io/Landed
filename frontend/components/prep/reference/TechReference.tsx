"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { TECH_COMPARISONS } from "@landed/shared/prep/reference/system-design-data";
import { SectionTitle } from "../ui";

// Side-by-side technology comparisons grouped by category (queue, DB, cache, …).
export default function TechReference() {
  const [open, setOpen] = useState<string | null>(TECH_COMPARISONS[0]?.category ?? null);
  return (
    <div>
      <SectionTitle title="Tech Reference" sub="What each option is, its strengths/weaknesses, and when to reach for it." />
      <div className="space-y-2">
        {TECH_COMPARISONS.map((cat) => {
          const on = open === cat.category;
          return (
            <div key={cat.category} className={`overflow-hidden rounded-xl border transition ${on ? "border-zinc-700 bg-zinc-900/40" : "border-zinc-800/70"}`}>
              <button onClick={() => setOpen(on ? null : cat.category)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="flex-1 text-sm font-semibold text-zinc-200">{cat.category}</span>
                <span className="font-mono text-[13px] text-zinc-600">{cat.options.length}</span>
                <ChevronDown size={15} className={`text-zinc-500 transition-transform ${on ? "rotate-180" : ""}`} />
              </button>
              {on && (
                <div className="space-y-2 border-t border-zinc-800/70 px-4 py-4">
                  {cat.options.map((o) => (
                    <div key={o.name} className="rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3">
                      <p className="text-sm font-semibold text-zinc-100">{o.name}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{o.what}</p>
                      <div className="mt-2 grid gap-1.5 text-[13px] sm:grid-cols-2">
                        <p className="text-emerald-300/90"><span className="font-semibold">+ </span>{o.strengths}</p>
                        <p className="text-rose-300/90"><span className="font-semibold">− </span>{o.weaknesses}</p>
                      </div>
                      <p className="mt-2 text-[13px] text-zinc-500"><span className="font-semibold text-zinc-400">When:</span> {o.when}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
