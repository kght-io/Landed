"use client";

import { GAME_STEPS, GAME_TIME_BUDGET, GAME_SIGNALS } from "@landed/shared/prep/reference/system-design-data";
import { Badge, levelCls, SectionTitle } from "../ui";

// The system-design opener drill: how to frame the first 5 minutes, the 60-min time
// budget, and the signals interviewers reward.
export default function GamePlan() {
  return (
    <div className="space-y-8">
      <div>
        <SectionTitle title="The Opener" sub="The first 5 minutes set the tone. Frame, clarify, scope, roadmap — then build." />
        <div className="space-y-2">
          {GAME_STEPS.map((s) => (
            <div key={s.num} className="flex gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/30 p-4">
              <span className="font-mono text-lg font-bold text-zinc-700">{s.num}</span>
              <div>
                <p className="text-sm font-semibold text-zinc-200">{s.label}</p>
                <p className="mt-0.5 text-[14px] leading-relaxed text-zinc-400">{s.prompt}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle title="Time Budget" sub="~60 minutes. Spend 20 on requirements and you've lost." />
        <div className="space-y-1.5">
          {GAME_TIME_BUDGET.map((t, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-zinc-800/60 px-4 py-2.5">
              <span className="mt-0.5 shrink-0 rounded bg-zinc-800 px-2 py-0.5 font-mono text-[13px] font-bold text-sky-300">
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
        <SectionTitle title="Signals They Reward" />
        <div className="space-y-2">
          {GAME_SIGNALS.map((s, i) => (
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
    </div>
  );
}
