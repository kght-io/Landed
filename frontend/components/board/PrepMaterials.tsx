"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, FileText, Mail, MessageSquareText, FolderOpen, CheckCircle2, Circle } from "lucide-react";
import type { Posting } from "@landed/shared/types";
import { getPrepAssets, type PrepAssets } from "@/lib/local-capability";
import { useAgentQueue } from "@/components/AgentQueueProvider";
import { AttachmentChip, revealPrepFolder } from "./PrepFiles";
import { SectionLabel, EDIT_BASE } from "./ui";

// One prep-material input row: a dumped-vs-missing dot + label + status line + an action, with an
// optional full-width `below` slot (the emails row lists the files it downloaded there).
function MaterialRow({ icon, label, done, status, children, below }: { icon: React.ReactNode; label: string; done: boolean; status: string; children?: React.ReactNode; below?: React.ReactNode }) {
  return (
    <div className="py-2">
      <div className="flex items-center gap-2.5">
        <span className={`shrink-0 ${done ? "text-emerald-400" : "text-zinc-600"}`}>{done ? <CheckCircle2 size={15} /> : <Circle size={15} />}</span>
        <span className="shrink-0 text-zinc-500">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-zinc-200">{label}</p>
          <p className="text-[12px] text-zinc-500">{status}</p>
        </div>
        {children}
      </div>
      {below}
    </div>
  );
}

// A queue-a-job action button with idle/queuing/queued states (mirrors GeneratePrep's old machine).
function RowButton({ state, label, onClick }: { state: "idle" | "queuing" | "queued"; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={state !== "idle"}
      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[12px] font-medium text-zinc-200 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-700 disabled:opacity-50"
    >
      {state === "queuing" && <Loader2 size={11} className="animate-spin" />}
      {state === "queuing" ? "Queuing\u2026" : state === "queued" ? "Queued" : label}
    </button>
  );
}

// Paste-a-transcript box + the list of transcripts already dropped for this company. The app can't
// record calls, so you paste one here and it's written to interview-prep/<slug>/transcripts/ — the
// interview-brief job reads that folder to ground the gaps. Fetches the current list on mount.
function TranscriptDrop({ postingId, onSaved }: { postingId: string; onSaved?: () => void }) {
  const [items, setItems] = useState<{ name: string; bytes: number; at: string }[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/applications/${postingId}/transcript`)
      .then((r) => r.json())
      .then((d) => { if (live) setItems(d.transcripts ?? []); })
      .catch(() => {});
    return () => { live = false; };
  }, [postingId]);

  const save = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/applications/${postingId}/transcript`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, title: title.trim() || undefined }),
      });
      const d = (await res.json().catch(() => ({}))) as { transcripts?: typeof items };
      if (d.transcripts) setItems(d.transcripts);
      setTitle(""); setBody("");
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionLabel>Call transcripts</SectionLabel>
      {items.length > 0 && (
        <ul className="mb-2 space-y-1">
          {items.map((t) => (
            <li key={t.name} className="flex items-center gap-2 text-[12px] text-zinc-400">
              <MessageSquareText size={12} className="shrink-0 text-zinc-600" />
              <span className="text-zinc-300">{t.name}</span>
              <span className="text-zinc-600">· {Math.max(1, Math.round(t.bytes / 1024))} KB · {t.at.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      )}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        placeholder="round label (optional) — e.g. System design w/ platform lead"
        className={`${EDIT_BASE} mb-1.5 block w-full rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-[12px] text-zinc-300 focus:border-zinc-600`}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        rows={3}
        placeholder="Paste the interview call transcript…"
        className={`${EDIT_BASE} block w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2 text-[13px] leading-relaxed text-zinc-300 focus:border-zinc-600`}
      />
      <div className="mt-1.5 flex justify-end">
        <button
          onClick={save}
          disabled={saving || !body.trim()}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-800 disabled:opacity-40"
        >
          <Plus size={12} /> {saving ? "Saving…" : "Add transcript"}
        </button>
      </div>
    </div>
  );
}

// The asset INPUTS that feed the interview brief — pull interview emails, add transcript — each with
// a dumped-vs-missing status, plus a link into the asset folder. Reads one status endpoint; each
// action (re)queues its job or writes a transcript, then refreshes.
export default function PrepMaterials({ p, onChanged }: { p: Posting; onChanged?: () => void }) {
  const { bump } = useAgentQueue();
  const [assets, setAssets] = useState<PrepAssets | null>(null);
  const [emailState, setEmailState] = useState<"idle" | "queuing" | "queued">("idle");
  const [dumping, setDumping] = useState(false);
  const [showPaste, setShowPaste] = useState(false);

  const refresh = useCallback(() => {
    getPrepAssets(p.id)
      .then((d) => { if (!("error" in d)) setAssets(d); })
      .catch(() => {});
  }, [p.id]);
  useEffect(() => { refresh(); }, [refresh]);

  const pullEmails = async () => {
    setEmailState("queuing");
    try { await fetch(`/api/applications/${p.id}/interview-emails`, { method: "POST" }); setEmailState("queued"); bump(); }
    catch { setEmailState("idle"); }
  };
  // Force a re-dump of context.md. Rarely needed — opening a chat and queuing an interview brief both
  // refresh the folder themselves — but it's here to see the timestamp and to push a change to disk
  // without starting either.
  const dumpContext = async () => {
    if (!assets?.slug) return;
    setDumping(true);
    try { await fetch(`/api/prep/company/${assets.slug}/export`, { method: "POST" }); refresh(); }
    finally { setDumping(false); }
  };
  const emails = assets?.emails;
  const files = emails?.attachments ?? [];
  const transcripts = assets?.transcripts ?? [];
  const contextAt = assets?.context?.at ?? null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="mb-1 flex items-center justify-between">
        <SectionLabel>Interview prep materials</SectionLabel>
        <button onClick={() => revealPrepFolder(p.id)} title="Reveal the interview-prep folder" className="inline-flex items-center gap-1 text-[12px] text-zinc-400 transition hover:text-zinc-200">
          <FolderOpen size={12} /> open folder
        </button>
      </div>
      <div className="divide-y divide-zinc-800/70">
        <MaterialRow
          icon={<Mail size={15} />}
          label="Interview emails"
          done={!!emails?.at}
          status={emails?.at ? `pulled ${emails.at.slice(0, 10)}${files.length ? ` · ${files.length} file${files.length === 1 ? "" : "s"}` : ""}` : "not pulled yet"}
          below={files.length ? (
            // Every file the recruiter sent, openable. A stage links the ones its rounds claimed;
            // this is the whole folder, so a file no round named is still one click away.
            <div className="mt-1.5 flex flex-wrap gap-1.5 pl-[46px]">
              {files.map((f) => <AttachmentChip key={f.name} postingId={p.id} name={f.name} bytes={f.bytes} />)}
            </div>
          ) : null}
        >
          <RowButton state={emailState} label={emails?.at ? "Re-pull" : "Pull"} onClick={pullEmails} />
        </MaterialRow>

        <MaterialRow
          icon={<MessageSquareText size={15} />}
          label="Call transcripts"
          done={transcripts.length > 0}
          status={transcripts.length ? `${transcripts.length} added` : "none added yet"}
        >
          <button onClick={() => setShowPaste((v) => !v)} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-800">
            <Plus size={12} /> add
          </button>
        </MaterialRow>

        <MaterialRow
          icon={<FileText size={15} />}
          label="Agent context"
          done={!!contextAt}
          status={contextAt ? `refreshed ${contextAt.slice(0, 10)} · context.md` : "written when a chat or brief needs it"}
        >
          <button
            onClick={dumpContext}
            disabled={dumping || !assets?.slug}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {dumping ? <Loader2 size={12} className="animate-spin" /> : null}
            {contextAt ? "Re-dump" : "Dump"}
          </button>
        </MaterialRow>
      </div>
      {showPaste && <div className="mt-2 border-t border-zinc-800 pt-2"><TranscriptDrop postingId={p.id} onSaved={() => { refresh(); onChanged?.(); }} /></div>}
    </div>
  );
}
