"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PrepQuestion } from "@landed/backend/db/prep";
import { usePrep } from "@/hooks/usePrep";
import AttemptControl from "./AttemptControl";
import ConfidenceTag from "./ConfidenceTag";
import { Badge, diffCls } from "./ui";

// Bespoke scenario question: prompt + why-it-matters, then approach,
// follow-ups, and gotchas on expand. Tracked via AttemptControl.
export default function ScenarioQuestionCard({
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
        <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 text-left">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ConfidenceTag q={q} />
              {q.priority && <Badge className="text-rose-300 bg-rose-500/10 ring-rose-500/25">{q.priority}</Badge>}
              <span className={`text-sm font-semibold ${q.done ? "text-zinc-400" : "text-zinc-100"}`}>{q.name}</span>
              {q.difficulty && <Badge className={diffCls(q.difficulty)}>{q.difficulty}</Badge>}
            </div>
            {q.prompt && <p className="mt-1.5 text-[14px] leading-relaxed text-zinc-400">{q.prompt}</p>}
          </div>
          <ChevronDown size={16} className={`mt-1 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

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
          {q.content.why && (
            <p className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5 p-3 text-[14px] leading-relaxed text-zinc-300">
              <span className="font-semibold text-fuchsia-300">Why it matters. </span>
              {q.content.why}
            </p>
          )}
          <Block title="Approach" items={q.content.approach} />
          <Block title="Follow-ups" items={q.content.followUps} accent="sky" />
          <Block title="Gotchas" items={q.content.gotchas} accent="amber" />
        </div>
      )}
    </div>
  );
}

function Block({ title, items, accent }: { title: string; items?: string[]; accent?: "amber" | "sky" }) {
  if (!items || items.length === 0) return null;
  const head = accent === "amber" ? "text-amber-400/80" : accent === "sky" ? "text-sky-400/80" : "text-zinc-600";
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
