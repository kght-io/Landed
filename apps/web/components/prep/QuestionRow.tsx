"use client";

import { ExternalLink, FileText, Loader2, RotateCcw } from "lucide-react";
import type { PrepQuestion } from "@landed/core/db/prep";
import { prettyCompany } from "@landed/shared/prep/leetcode";
import { usePrep } from "@/hooks/usePrep";
import AttemptControl from "./AttemptControl";
import ConfidenceTag from "./ConfidenceTag";
import { Badge, diffCls } from "./ui";

// A single trackable coding problem (name, difficulty, note, flags, attempt control).
// Shared by the curriculum tracker and the company hit lists. `showCompanies` adds a chip per
// company that features the question — used only in the generic Leetcode tracker (redundant in a
// company lens, where every row already belongs to that company).
export default function QuestionRow({
  q,
  onLog,
  onUndo,
  onNoted,
  onRedo,
  showCompanies = false,
}: {
  q: PrepQuestion;
  onLog: ReturnType<typeof usePrep>["logAttempt"];
  onUndo: ReturnType<typeof usePrep>["undoLast"];
  onNoted: ReturnType<typeof usePrep>["setNoted"];
  onRedo: ReturnType<typeof usePrep>["setRedo"];
  showCompanies?: boolean;
}) {
  return (
    <div className="border-b border-zinc-800/40 py-2.5 last:border-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ConfidenceTag q={q} />
            {q.plan?.anchor && <Badge className="text-emerald-300 bg-emerald-500/10 ring-emerald-500/25">anchor</Badge>}
            {q.plan?.extra && <Badge className="text-zinc-400 bg-zinc-800/60 ring-zinc-700/50">extra</Badge>}
            {q.priority && <Badge className="text-rose-300 bg-rose-500/10 ring-rose-500/25">{q.priority}</Badge>}
            {q.url ? (
              <a
                href={q.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1 text-[14px] font-medium hover:text-emerald-300 ${
                  q.done ? "text-zinc-500 line-through" : "text-zinc-200"
                }`}
              >
                {q.name}
                <ExternalLink size={11} className="opacity-50" />
              </a>
            ) : (
              <span className={`text-[14px] font-medium ${q.done ? "text-zinc-500" : "text-zinc-200"}`}>{q.name}</span>
            )}
            {q.leetcodeNum != null && <span className="font-mono text-[12px] text-zinc-600">#{q.leetcodeNum}</span>}
            {q.content.pendingEnrich ? (
              <Badge className="text-zinc-400 bg-zinc-800/60 ring-zinc-700/50">
                <span className="inline-flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> enriching…</span>
              </Badge>
            ) : (
              q.difficulty && <Badge className={diffCls(q.difficulty)}>{q.difficulty}</Badge>
            )}
            {showCompanies && q.companies.map((slug) => (
              <Badge key={slug} className="text-fuchsia-300 bg-fuchsia-500/10 ring-fuchsia-500/25">{prettyCompany(slug)}</Badge>
            ))}
          </div>
          {q.content.note && <p className="mt-1 font-mono text-[13px] leading-relaxed text-zinc-500">{q.content.note}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onNoted(q.id, !q.noted)}
            title={q.noted ? "Notes written" : "Mark notes written"}
            className={`rounded p-1 ring-1 ring-inset transition ${
              q.noted ? "text-cyan-300 bg-cyan-500/10 ring-cyan-500/30" : "text-zinc-600 ring-transparent hover:text-cyan-300"
            }`}
          >
            <FileText size={13} />
          </button>
          <button
            onClick={() => onRedo(q.id, !q.redo)}
            title={q.redo ? "Remove from redo queue" : "Add to redo queue"}
            className={`rounded p-1 ring-1 ring-inset transition ${
              q.redo ? "text-amber-300 bg-amber-500/10 ring-amber-500/30" : "text-zinc-600 ring-transparent hover:text-amber-300"
            }`}
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      <div className="mt-2">
        <AttemptControl q={q} onLog={onLog} onUndo={onUndo} compact />
      </div>
    </div>
  );
}
