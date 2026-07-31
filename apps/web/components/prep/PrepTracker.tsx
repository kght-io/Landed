"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronDown, Loader2, Plus, RotateCcw } from "lucide-react";
import { usePrep } from "@/hooks/usePrep";
import { useAgentQueue } from "@/components/AgentQueueProvider";
import type { PrepQuestion } from "@landed/core/db/prep";
import { questionTopic } from "@landed/shared/prep/leetcode";
import QuestionRow from "./QuestionRow";
import TabBar from "./TabBar";

// The Leetcode tracker: ALL coding questions — the curriculum, manually-added, and company-sourced —
// grouped by topic, with an overall progress bar, per-topic collapsibles, noted/redo flags, and a
// redo queue. Manually add a problem by pasting its LeetCode URL (an agent job fills the details).
// DB-backed via usePrep — progress persists server-side.
export default function PrepTracker({ track, company }: { track: string; company?: string }) {
  const { questions, loading, reload, logAttempt, undoLast, setNoted, setRedo } = usePrep(track, company);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [tab, setTab] = useState("problems");
  const canAdd = track === "coding" && !company;

  // Group every question by topic (curriculum pattern → first tag → Uncategorized), ordering topics
  // by where they first appear (min sortOrder — keeps the seeded curriculum patterns up top).
  const categories = useMemo(() => {
    const byCat = new Map<string, PrepQuestion[]>();
    for (const q of questions) {
      const cat = questionTopic(q);
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(q);
    }
    return [...byCat.entries()].sort(
      (a, b) => Math.min(...a[1].map((q) => q.sortOrder ?? 0)) - Math.min(...b[1].map((q) => q.sortOrder ?? 0))
    );
  }, [questions]);

  const total = questions.length;
  const done = questions.filter((q) => q.done).length;
  const noted = questions.filter((q) => q.noted).length;
  const redoList = questions.filter((q) => q.redo);
  const pct = total ? Math.round((done / total) * 100) : 0;

  if (loading)
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> loading…
      </div>
    );

  const tabs = [
    { id: "problems", label: "Problems" },
    { id: "redo", label: redoList.length ? `Redo queue (${redoList.length})` : "Redo queue" },
    ...(canAdd ? [{ id: "new", label: "New" }] : []),
  ];
  // "New" only exists when canAdd — never leave the view stranded on a hidden tab.
  const active = tab === "new" && !canAdd ? "problems" : tab;

  return (
    <div className="space-y-5">
      <TabBar tabs={tabs} active={active} onChange={setTab} />

      {active === "problems" && (
        <div className="space-y-5">
          {/* progress summary */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-5 py-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-zinc-300">
                {done}/{total} solved
                {noted > 0 && <span className="ml-2 text-cyan-400">· {noted} noted</span>}
                {redoList.length > 0 && <span className="ml-2 text-amber-400">· {redoList.length} in redo</span>}
              </span>
              <span className={`font-mono text-sm font-bold ${pct === 100 ? "text-emerald-400" : "text-emerald-300"}`}>
                {pct}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
              <div
                className={`h-full rounded transition-all duration-500 ${pct === 100 ? "bg-emerald-400" : "bg-emerald-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {total === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800/70 py-8 text-center text-[13px] text-zinc-600">
              {canAdd ? "no questions yet — add one from the New tab" : "no questions yet"}
            </div>
          ) : (
            <div className="space-y-1.5">
              {categories.map(([cat, probs]) => {
                const open = openCat === cat;
                const cDone = probs.filter((p) => p.done).length;
                const allDone = probs.length > 0 && cDone === probs.length;
                return (
                  <div
                    key={cat}
                    className={`overflow-hidden rounded-xl border transition ${
                      open ? "border-zinc-700 bg-zinc-900/40" : "border-zinc-800/70"
                    }`}
                  >
                    <button
                      onClick={() => setOpenCat(open ? null : cat)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <span className="flex-1 text-sm font-medium text-zinc-200">{cat}</span>
                      <span className={`font-mono text-[13px] ${allDone ? "font-bold text-emerald-400" : "text-zinc-500"}`}>
                        {allDone ? "✓ done" : `${cDone}/${probs.length}`}
                      </span>
                      <ChevronDown size={15} className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                    {open && (
                      <div className="border-t border-zinc-800/70 px-4 py-1">
                        {probs.map((q) => (
                          <QuestionRow
                            key={q.id}
                            q={q}
                            onLog={logAttempt}
                            onUndo={undoLast}
                            onNoted={setNoted}
                            onRedo={setRedo}
                            showCompanies
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {active === "redo" && (
        redoList.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/5">
            <div className="flex items-center gap-2 border-b border-amber-500/20 px-4 py-3 text-sm font-semibold text-amber-300">
              <RotateCcw size={14} /> Redo queue — {redoList.length}
            </div>
            <div className="px-4 py-1">
              {redoList.map((q) => (
                <QuestionRow key={q.id} q={q} onLog={logAttempt} onUndo={undoLast} onNoted={setNoted} onRedo={setRedo} showCompanies />
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-800/70 py-8 text-center text-[13px] text-zinc-600">
            redo queue is empty — flag a problem with the ↻ button to revisit it here
          </div>
        )
      )}

      {active === "new" && canAdd && <AddLeetcode onAdded={reload} />}
    </div>
  );
}

// Manual add: paste a LeetCode URL (+ optional topic). Inserts a stub immediately and queues a
// leetcode-add the agent job to fill the name/difficulty/topic (see leetcode-add.md).
function AddLeetcode({ onAdded }: { onAdded: () => void }) {
  const { bump } = useAgentQueue();
  const [url, setUrl] = useState("");
  const [topic, setTopic] = useState("");
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const u = url.trim();
    if (!u) return;
    setAdding(true);
    setMsg(null);
    try {
      const r = await fetch("/api/prep/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u, topic: topic.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg(d.error === "not a LeetCode problem URL" ? "That doesn't look like a LeetCode problem URL." : "Couldn't add — is the app running?");
        return;
      }
      if (d.status === "exists") {
        setMsg(`Already tracked: ${d.question?.name ?? "that problem"}.`);
      } else {
        pendo.track("leetcode_question_added", { url: u, has_topic: !!topic.trim() });
        setMsg(`Added ${d.question?.name ?? "problem"} — The agent will fill the details. Run your the agent queue.`);
        setUrl("");
        setTopic("");
        bump(); // surface the queued job in the floating queue
      }
      onAdded();
    } catch {
      setMsg("Couldn't add — is the app running?");
    } finally {
      setAdding(false);
    }
  }, [url, topic, bump, onAdded]);

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-3">
      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="flex flex-wrap items-center gap-2"
      >
        <div className="relative min-w-0 flex-1">
          <Plus size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a LeetCode problem URL — the agent fills name, difficulty & topic"
            className="w-full rounded-md bg-zinc-950/60 py-1.5 pl-8 pr-2.5 text-[13px] text-zinc-200 outline-none ring-1 ring-inset ring-zinc-800 transition placeholder:text-zinc-600 hover:ring-zinc-700 focus:ring-zinc-600"
          />
        </div>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic (optional)"
          title="e.g. Heap. Leave blank and the agent infers it."
          className="w-40 shrink-0 rounded-md bg-zinc-950/60 py-1.5 px-2.5 text-[13px] text-zinc-200 outline-none ring-1 ring-inset ring-zinc-800 transition placeholder:text-zinc-600 hover:ring-zinc-700 focus:ring-zinc-600"
        />
        <button
          type="submit"
          disabled={adding || !url.trim()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 py-1.5 text-[13px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          Add
        </button>
      </form>
      {msg && <p className="mt-2 text-[12px] text-zinc-500">{msg}</p>}
    </div>
  );
}
