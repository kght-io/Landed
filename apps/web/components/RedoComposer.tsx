"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAgentQueue } from "@/components/AgentQueueProvider";
import type { RedoPhase } from "@landed/shared/types";

// "Redo with a note" — a prominent composer pinned below a detail view (the résumé diff or the fit
// assessment). Queues the next version for the agent (the note becomes a turn in the posting's redo
// conversation) and pulses the floating queue. Shared by ResumeDiffModal (tailor) and
// FitDetailModal (fit) so both flows read and feel identical.
const COPY: Record<RedoPhase, { heading: string; placeholder: string }> = {
  tailor: {
    heading: "Not quite? Redo this résumé with a note",
    placeholder: "e.g. lead with the ledger rewrite, cut the mobile bullets — ⌘↵ to queue",
  },
  fit: {
    heading: "Not quite? Redo this assessment with a note",
    placeholder: "e.g. weight leadership scope over IC depth — ⌘↵ to queue",
  },
};

// `initialNote` pre-fills the box with the note of an already-queued redo so reopening the popup
// remembers it and the user can edit it (re-queuing edits in place — see requeueRedo).
export default function RedoComposer({ postingId, phase, initialNote }: { postingId: string; phase: RedoPhase; initialNote?: string }) {
  const { bump } = useAgentQueue();
  const editing = !!initialNote;
  const [note, setNote] = useState(initialNote ?? "");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    const text = note.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const r = await fetch(`/api/applications/${postingId}/redo`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phase, note: text }),
      });
      if (r.ok) {
        pendo.track("redo_queued", {
          posting_id: postingId,
          phase,
          note_length: text.length,
          is_edit: editing,
        });
        setDone(true); setNote(""); bump();
      }
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="flex items-center gap-2 border-t border-zinc-800 bg-violet-500/[0.08] px-4 py-3 text-[13px] text-violet-200">
        <RefreshCw size={14} className="shrink-0" />
        Redo {editing ? "updated" : "queued"} — run the Claude Code runner to drain your queue and produce the next version.
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/70 px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-zinc-200">
        <RefreshCw size={13} className="text-violet-300" /> {editing ? "Edit the queued redo" : COPY[phase].heading}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
          rows={2}
          placeholder={COPY[phase].placeholder}
          className="flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-[13px] text-zinc-200 outline-none transition focus:border-violet-500/60"
        />
        <button
          onClick={submit}
          disabled={!note.trim() || sending}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-violet-500 px-4 py-2 text-[13px] font-semibold text-violet-50 shadow-lg shadow-violet-500/20 transition hover:bg-violet-400 disabled:opacity-40 disabled:shadow-none"
        >
          <RefreshCw size={14} /> {sending ? (editing ? "Updating…" : "Queuing…") : (editing ? "Update redo" : "Queue redo")}
        </button>
      </div>
    </div>
  );
}
