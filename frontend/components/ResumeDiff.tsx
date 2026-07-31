"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, GitCompareArrows, Loader2, X } from "lucide-react";
import RedoComposer from "@/components/RedoComposer";
import type { DiffOp } from "@landed/shared/linediff";

type DiffResult = { ok: true; slug: string; base: string; added: number; removed: number; ops: DiffOp[] } | { error: string };

// A git-style diff of a tailored resume against the base, as a modal. Prefers the agent's own
// **annotated** diff (each changed line carries *why* it changed) when the version supplies one;
// otherwise falls back to a *text* diff the app computes by extracting both .docx via textutil
// (wording/content changes, not formatting). When a `postingId` is supplied, a prominent "redo with
// a note" composer sits below the diff so you can write the redo instruction while reading exactly
// what changed.
export default function ResumeDiffModal({ slug, title, postingId, redoNote, annotated, onClose }: { slug: string; title?: string; postingId?: string; redoNote?: string | null; annotated?: DiffOp[]; onClose: () => void }) {
  const [data, setData] = useState<DiffResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // The agent already shipped the annotated diff with this version — render it directly, no fetch.
    if (annotated) return;
    // The modal is keyed by slug at the call site, so each slug gets a fresh mount (data starts
    // null) — no need to reset state here, which keeps this effect a pure external-sync.
    let alive = true;
    fetch(`/api/resume/diff?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setData({ error: String(e) }); });
    return () => { alive = false; };
  }, [slug, annotated]);

  const openFolder = () =>
    fetch("/api/resume/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }) }).catch(() => {});

  // The annotated diff (preferred) or the fetched computed diff, normalized to one shape.
  const ok = annotated
    ? { base: "base résumé", added: annotated.filter((o) => o.type === "add").length, removed: annotated.filter((o) => o.type === "del").length, ops: annotated }
    : data && "ok" in data ? data : null;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
          <GitCompareArrows size={15} className="shrink-0 text-violet-300" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-zinc-200">{title ?? slug}</div>
            <div className="truncate font-mono text-[11px] text-zinc-500">
              {ok ? <>{ok.base} → tailored · <span className="text-emerald-400">+{ok.added}</span> <span className="text-rose-300">−{ok.removed}</span></> : slug}
            </div>
          </div>
          <button onClick={openFolder} title="Reveal this résumé's folder in Finder" className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-[12px] font-semibold text-sky-50 shadow-sm transition hover:bg-sky-400">
            <FolderOpen size={14} /> Open in Finder
          </button>
          <button onClick={onClose} title="Close (Esc)" className="shrink-0 text-zinc-500 transition hover:text-zinc-200"><X size={16} /></button>
        </div>

        {!annotated && !data ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-zinc-500"><Loader2 size={16} className="animate-spin" /> diffing…</div>
        ) : !annotated && data && "error" in data ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-[13px] text-zinc-500">
            <p>Couldn’t diff this resume.</p>
            <p className="font-mono text-[12px] text-zinc-600">{data.error}</p>
          </div>
        ) : ok && ok.ops.every((o) => o.type === "eq") ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-zinc-500">No text changes vs the base resume.</div>
        ) : ok ? (
          <div className="flex-1 overflow-auto bg-zinc-950 py-2 text-[12px] leading-relaxed">
            {ok.ops.map((op, i) => (
              <DiffLine key={i} op={op} />
            ))}
          </div>
        ) : null}

        {postingId && <RedoComposer postingId={postingId} phase="tailor" initialNote={redoNote ?? undefined} />}
      </div>
    </div>,
    document.body,
  );
}

function DiffLine({ op }: { op: DiffOp }) {
  const cls =
    op.type === "add" ? "bg-emerald-500/10 text-emerald-300"
      : op.type === "del" ? "bg-rose-500/10 text-rose-300"
      : "text-zinc-500";
  const gutter = op.type === "add" ? "+" : op.type === "del" ? "−" : " ";
  const gutterCls = op.type === "add" ? "text-emerald-400" : op.type === "del" ? "text-rose-300" : "text-zinc-700";
  return (
    <div className={`px-4 ${cls}`}>
      <div className="flex gap-3 font-mono">
        <span className={`w-3 shrink-0 select-none text-right ${gutterCls}`}>{gutter}</span>
        <span className="whitespace-pre-wrap break-words">{op.text}</span>
      </div>
      {op.comment && (
        // the agent's rationale for this line — *why* it changed. Indented under the text, set apart in
        // sans + violet so it reads as annotation, not résumé content.
        <div className="flex gap-3">
          <span className="w-3 shrink-0 select-none" />
          <span className="font-sans text-[11px] italic leading-snug text-violet-300/80">{op.comment}</span>
        </div>
      )}
    </div>
  );
}
