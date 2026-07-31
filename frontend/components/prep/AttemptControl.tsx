"use client";

import { useState } from "react";
import { Check, Clock, RotateCcw } from "lucide-react";
import type { PrepQuestion, AttemptStatus } from "@landed/backend/db/prep";
import { fmtTime, timeCls } from "./ui";

// The reusable progress widget shared by the coding tracker rows and the system-design
// question cards. Writes go through usePrep → the DB. Logging records an attempt; the
// checkbox quick-marks done (or undoes the latest attempt).
export default function AttemptControl({
  q,
  onLog,
  onUndo,
  compact = false,
}: {
  q: PrepQuestion;
  onLog: (id: string, opts: { durationSec?: number; status?: AttemptStatus }) => void;
  onUndo: (id: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mins, setMins] = useState("");
  const [status, setStatus] = useState<AttemptStatus>("solved");

  function submit() {
    const m = parseFloat(mins);
    onLog(q.id, {
      durationSec: Number.isFinite(m) && m > 0 ? Math.round(m * 60) : undefined,
      status,
    });
    setMins("");
    setStatus("solved");
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {/* done checkbox: empty → quick-log solved; filled → undo latest attempt */}
        <button
          onClick={() => (q.done ? onUndo(q.id) : onLog(q.id, { status: "solved" }))}
          title={q.done ? "Undo latest attempt" : "Mark solved"}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
            q.done
              ? "border-emerald-500 bg-emerald-500 text-emerald-950"
              : "border-zinc-600 text-transparent hover:border-zinc-400"
          }`}
        >
          <Check size={13} strokeWidth={3} />
        </button>

        {q.timesDone > 0 && (
          <span className="font-mono text-[13px] text-zinc-500" title={`${q.timesDone} attempts logged`}>
            ×{q.timesDone}
          </span>
        )}
        {q.bestSec != null && (
          <span className={`inline-flex items-center gap-0.5 font-mono text-[13px] ${timeCls(q.bestSec)}`} title="Best time">
            <Clock size={11} /> {fmtTime(q.bestSec)}
          </span>
        )}

        <button
          onClick={() => setOpen((o) => !o)}
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[13px] text-zinc-500 ring-1 ring-inset ring-zinc-800 transition hover:text-zinc-200 hover:ring-zinc-600"
        >
          {compact ? "log" : "log attempt"}
        </button>
      </div>

      {open && (
        <div className="flex items-center gap-1.5 pl-7">
          <input
            type="number"
            min={0}
            step="0.5"
            value={mins}
            onChange={(e) => setMins(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="min"
            autoFocus
            className="w-16 rounded bg-zinc-900 px-2 py-1 font-mono text-[13px] text-zinc-200 ring-1 ring-inset ring-zinc-800 outline-none placeholder:text-zinc-600 focus:ring-zinc-600"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as AttemptStatus)}
            className="rounded bg-zinc-900 px-1.5 py-1 text-[13px] text-zinc-300 ring-1 ring-inset ring-zinc-800 outline-none focus:ring-zinc-600 [color-scheme:dark]"
          >
            <option value="solved">solved</option>
            <option value="partial">partial</option>
            <option value="failed">failed</option>
          </select>
          <button
            onClick={submit}
            className="rounded bg-emerald-500 px-2 py-1 text-[13px] font-medium text-emerald-950 transition hover:bg-emerald-400"
          >
            Log
          </button>
          {q.lastAttemptId != null && (
            <button
              onClick={() => onUndo(q.id)}
              title="Undo latest attempt"
              className="rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-rose-300"
            >
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
