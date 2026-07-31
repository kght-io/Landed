"use client";

import { FAILURE_STORIES } from "@landed/shared/prep/reference/system-design-data";
import { SectionTitle } from "../ui";

// Common distributed-systems failure modes: scenario → fix → lesson.
export default function FailureModes() {
  return (
    <div>
      <SectionTitle title="Failure Modes" sub="Name the failure, the mitigation, and the lesson — interviewers probe for these." />
      <div className="space-y-2">
        {FAILURE_STORIES.map((f) => (
          <div key={f.id} className="rounded-xl border border-zinc-800/70 bg-zinc-900/30 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <span>{f.icon}</span> {f.title}
            </p>
            <p className="text-[14px] leading-relaxed text-zinc-400">
              <span className="font-semibold text-rose-300/80">Scenario. </span>
              {f.scenario}
            </p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-zinc-400">
              <span className="font-semibold text-emerald-300/80">Fix. </span>
              {f.fix}
            </p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-zinc-300">
              <span className="font-semibold text-amber-300/80">Lesson. </span>
              {f.lesson}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
