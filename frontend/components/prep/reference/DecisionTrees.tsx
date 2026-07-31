"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { DECISION_TREES } from "@landed/shared/prep/reference/system-design-data";
import { SectionTitle } from "../ui";

type Answer = { name: string; what: string; say: string };
type Option = { label: string; answer?: Answer; next?: TreeNodeData };
type TreeNodeData = { q: string; options: Option[] };
type Tree = { label: string; root: TreeNodeData };

const TREES = DECISION_TREES as unknown as Record<string, Tree>;

// Interactive "which technology?" decision trees. Click an option to walk the branch
// down to a recommendation (with a ready-to-say justification).
export default function DecisionTrees() {
  const keys = Object.keys(TREES);
  const [active, setActive] = useState(keys[0]);
  return (
    <div>
      <SectionTitle title="Tech Decisions" sub="Walk the branch to a recommendation — and the sentence to say out loud." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {keys.map((k) => (
          <button
            key={k}
            onClick={() => setActive(k)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
              active === k ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
            }`}
          >
            {TREES[k].label}
          </button>
        ))}
      </div>
      <Node node={TREES[active].root} />
    </div>
  );
}

function Node({ node }: { node: TreeNodeData }) {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-[14px] font-semibold text-zinc-200">{node.q}</p>
      <div className="space-y-1.5 border-l border-zinc-800 pl-3">
        {node.options.map((o, i) => {
          const on = picked === i;
          return (
            <div key={i}>
              <button
                onClick={() => setPicked(on ? null : i)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] transition ${
                  on ? "bg-zinc-800 text-zinc-100" : "bg-zinc-900/40 text-zinc-300 hover:bg-zinc-900"
                }`}
              >
                <ChevronRight size={13} className={`shrink-0 transition-transform ${on ? "rotate-90" : ""}`} />
                {o.label}
              </button>
              {on && (
                <div className="mt-1.5 pl-4">
                  {o.next && <Node node={o.next} />}
                  {o.answer && (
                    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
                      <p className="text-sm font-semibold text-emerald-300">{o.answer.name}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{o.answer.what}</p>
                      <p className="mt-2 text-[13px] italic leading-relaxed text-zinc-300">“{o.answer.say}”</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
