"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FilePlus2, Loader2, Sparkles, X } from "lucide-react";
import { useAgentQueue } from "@/components/AgentQueueProvider";

// Fired on the window after a JD is queued, so any mounted list (the pipeline) can refresh. Shared
// constant so the dispatch here and the listener in Pipeline can't drift apart on a typo.
export const JOB_ADDED_EVENT = "landed:job-added";

// Add a job to Fit Assessment by pasting its JD — the manual entry point that mirrors discovery.
// POSTs to /api/jobs/fit (enqueueFit): ensures a fit_queue candidate exists and queues a fit job
// for the agent to score. Company + JD are required; role/url are optional context. Opened from the
// Fit Assessment view's toolbar.
export default function AddFitModal({ onClose }: { onClose: () => void }) {
  const { bump } = useAgentQueue();
  const [form, setForm] = useState({ company: "", role: "", url: "", jd: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Match the API's own gate: company + a JD with enough substance to score.
  const canSubmit = form.company.trim().length > 0 && form.jd.trim().length >= 50 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs/fit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: form.company.trim(),
          role: form.role.trim() || undefined,
          url: form.url.trim() || undefined,
          jd: form.jd.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to queue fit assessment");
      bump(); // handed work to the agent — pulse the queue
      // Let any mounted view (e.g. the pipeline) refresh its list — the modal can now be opened
      // globally from the nav rail, decoupled from whoever renders the funnel.
      window.dispatchEvent(new CustomEvent(JOB_ADDED_EVENT));
      onClose();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
          <FilePlus2 size={15} className="shrink-0 text-emerald-300" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-zinc-200">Add a job to Fit Assessment</div>
            <div className="truncate text-[11px] text-zinc-500">Paste a job description — the agent scores it against your profile.</div>
          </div>
          <button onClick={onClose} title="Close (Esc)" className="shrink-0 text-zinc-500 transition hover:text-zinc-200"><X size={16} /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Company</span>
              <input
                value={form.company}
                onChange={set("company")}
                placeholder="Linear"
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Role <span className="text-zinc-600">(optional)</span></span>
              <input
                value={form.role}
                onChange={set("role")}
                placeholder="Product Engineer"
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Posting URL <span className="text-zinc-600">(optional)</span></span>
            <input
              value={form.url}
              onChange={set("url")}
              placeholder="https://…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Job description</span>
            <textarea
              value={form.jd}
              onChange={set("jd")}
              rows={10}
              placeholder="Paste the full job description here…"
              className="w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-[13px] leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </label>
          {error && <p className="text-[12px] text-rose-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-2.5">
          <button onClick={onClose} className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-zinc-400 transition hover:text-zinc-200">Cancel</button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-emerald-500/90 px-2.5 py-1.5 text-[13px] font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-default disabled:opacity-50"
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Queue fit assessment
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
