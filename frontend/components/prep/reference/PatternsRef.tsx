"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { PATTERNS } from "@landed/shared/prep/reference/coding-data";
import { Badge, Code, SectionTitle } from "../ui";

// Algorithm-pattern reference cards (expandable): description, when-to-use, code
// template, key problems, gotchas.
export default function PatternsRef() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <SectionTitle
        title="Algorithm Patterns"
        sub="Heap / k-way merge, binary search, and sliding window come up constantly. Master these."
      />
      <div className="space-y-2">
        {PATTERNS.map((p) => {
          const on = open === p.id;
          return (
            <div
              key={p.id}
              className={`overflow-hidden rounded-xl border transition ${on ? "border-zinc-700 bg-zinc-900/40" : "border-zinc-800/70"}`}
            >
              <button onClick={() => setOpen(on ? null : p.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="text-lg text-zinc-400">{p.icon}</span>
                <span className="flex-1 text-sm font-semibold text-zinc-200">{p.name}</span>
                <ChevronDown size={15} className={`text-zinc-500 transition-transform ${on ? "rotate-180" : ""}`} />
              </button>
              {on && (
                <div className="space-y-4 border-t border-zinc-800/70 px-4 py-4">
                  <div className="flex flex-wrap gap-1.5">
                    {p.tags.map((t) => (
                      <Badge key={t} className="text-zinc-400 bg-zinc-800/60 ring-zinc-700/50">{t}</Badge>
                    ))}
                  </div>
                  <p className="text-[14px] leading-relaxed text-zinc-400">{p.description}</p>

                  <div>
                    <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-wider text-zinc-600">When to use</p>
                    <ul className="space-y-1">
                      {p.when.map((w, i) => (
                        <li key={i} className="text-[14px] leading-relaxed text-zinc-300">• {w}</li>
                      ))}
                    </ul>
                  </div>

                  {p.template && <Code>{p.template}</Code>}

                  <div>
                    <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-wider text-zinc-600">Key problems</p>
                    <div className="space-y-1.5">
                      {p.keyProblems.map((k) => (
                        <div key={k.num} className="text-[14px] text-zinc-300">
                          <span className="font-medium text-zinc-200">{k.name}</span>
                          <span className="ml-1 font-mono text-[12px] text-zinc-600">#{k.num}</span>
                          <span className="ml-2 text-zinc-500">{k.note}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-wider text-amber-400/80">Gotchas</p>
                    <ul className="space-y-1">
                      {p.gotchas.map((g, i) => (
                        <li key={i} className="text-[14px] leading-relaxed text-amber-200/80">• {g}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
