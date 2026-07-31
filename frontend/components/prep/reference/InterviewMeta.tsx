"use client";

import { SIGNALS, TIME_BUDGET, META } from "@landed/shared/prep/reference/coding-data";
import { Badge, levelCls, SectionTitle } from "../ui";

// Coding interview meta: what signals interviewers evaluate, the OA time budget, and
// strategy reminders.
export default function InterviewMeta() {
  return (
    <div className="space-y-8">
      <div>
        <SectionTitle title="Signals They Evaluate" sub="What separates a pass from a strong-hire on the OA + live rounds." />
        <div className="space-y-2">
          {SIGNALS.map((s, i) => (
            <div key={i} className="rounded-xl border border-zinc-800/70 bg-zinc-900/30 p-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-zinc-400">{s.icon}</span>
                <span className="flex-1 text-sm font-semibold text-zinc-200">{s.signal}</span>
                <Badge className={levelCls(s.level)}>{s.level}</Badge>
              </div>
              <p className="text-[14px] leading-relaxed text-zinc-400">{s.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle title="OA Time Budget" sub="~35 min per problem. Don't start coding without a verbal commit on approach." />
        <div className="space-y-1.5">
          {TIME_BUDGET.map((t, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-zinc-800/60 px-4 py-2.5">
              <span className="mt-0.5 shrink-0 rounded bg-zinc-800 px-2 py-0.5 font-mono text-[13px] font-bold text-emerald-300">
                {t.min}–{t.max}m
              </span>
              <div>
                <p className="text-[14px] font-medium text-zinc-200">{t.phase}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-500">{t.tip}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle title="Strategy Reminders" />
        <div className="space-y-2">
          {META.map((m, i) => (
            <div key={i} className="rounded-xl border border-zinc-800/70 bg-zinc-900/30 p-4">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-zinc-400">{m.icon}</span>
                <span className="text-sm font-semibold text-zinc-200">{m.title}</span>
              </div>
              <p className="text-[14px] leading-relaxed text-zinc-400">{m.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
