"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PrepQuestion } from "@landed/backend/db/prep";
import { usePrep } from "@/hooks/usePrep";
import AttemptControl from "./AttemptControl";
import ConfidenceTag from "./ConfidenceTag";
import { Badge, diffCls } from "./ui";

// System-design question card: collapsed shows prompt + meta + tracking; expanded adds
// key components, deep-dive probes, and monitoring signals.
export default function QuestionCard({
  q,
  onLog,
  onUndo,
}: {
  q: PrepQuestion;
  onLog: ReturnType<typeof usePrep>["logAttempt"];
  onUndo: ReturnType<typeof usePrep>["undoLast"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`overflow-hidden rounded-xl border transition ${open ? "border-zinc-700 bg-zinc-900/40" : "border-zinc-800/70"}`}>
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <button onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <ConfidenceTag q={q} />
              {q.content.category && (
                <Badge className="text-zinc-400 bg-zinc-800/60 ring-zinc-700/50">{q.content.category}</Badge>
              )}
              {q.content.tier != null && (
                <Badge className="text-indigo-300 bg-indigo-500/10 ring-indigo-500/25">Tier {q.content.tier}</Badge>
              )}
              <span className={`text-sm font-semibold ${q.done ? "text-zinc-400" : "text-zinc-100"}`}>{q.name}</span>
              {q.difficulty && <Badge className={diffCls(q.difficulty)}>{q.difficulty}</Badge>}
            </div>
            {q.prompt && <p className="mt-1.5 text-[14px] leading-relaxed text-zinc-400">{q.prompt}</p>}
          </button>
          <ChevronDown
            size={16}
            onClick={() => setOpen((o) => !o)}
            className={`mt-1 shrink-0 cursor-pointer text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>

        <div className="mt-3 border-t border-zinc-800/50 pt-2.5">
          <AttemptControl q={q} onLog={onLog} onUndo={onUndo} />
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t border-zinc-800/70 bg-zinc-950/30 px-4 py-4">
          {q.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {q.tags.map((t) => (
                <Badge key={t} className="text-zinc-400 bg-zinc-800/60 ring-zinc-700/50">{t}</Badge>
              ))}
            </div>
          )}
          <Block title="Key components" items={q.content.keyComponents} />
          <Block title="Deep-dive probes" items={q.content.deepDive} accent="amber" />
          <Block title="Monitoring" items={q.content.monitoring} accent="cyan" />
        </div>
      )}
    </div>
  );
}

function Block({ title, items, accent }: { title: string; items?: string[]; accent?: "amber" | "cyan" }) {
  if (!items || items.length === 0) return null;
  const head =
    accent === "amber" ? "text-amber-400/80" : accent === "cyan" ? "text-cyan-400/80" : "text-zinc-600";
  return (
    <div>
      <p className={`mb-1.5 text-[13px] font-semibold uppercase tracking-wider ${head}`}>{title}</p>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-[14px] leading-relaxed text-zinc-300">• {it}</li>
        ))}
      </ul>
    </div>
  );
}
