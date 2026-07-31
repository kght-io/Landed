"use client";

import { Loader2 } from "lucide-react";
import { usePrep } from "@/hooks/usePrep";
import QuestionCard from "./QuestionCard";
import { SectionTitle } from "./ui";

// DB-backed list of system-design questions (a lens of the shared question bank).
export default function QuestionList({ track, company }: { track: string; company?: string }) {
  const { questions, loading, logAttempt, undoLast } = usePrep(track, company);
  const done = questions.filter((q) => q.done).length;

  if (loading)
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> loading…
      </div>
    );

  return (
    <div>
      <SectionTitle
        title="Question Bank"
        sub={`${done}/${questions.length} attempted · expand any for architecture, deep-dive probes, and monitoring.`}
      />
      <div className="space-y-2">
        {questions.map((q) => (
          <QuestionCard key={q.id} q={q} onLog={logAttempt} onUndo={undoLast} />
        ))}
      </div>
    </div>
  );
}
