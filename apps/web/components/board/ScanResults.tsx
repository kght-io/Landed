"use client";

import { useState } from "react";
import { Sparkles, X, Loader2 } from "lucide-react";
import { useAgentQueue } from "@/components/AgentQueueProvider";

// Consistent hour/day relative time for the "Scanned" column (avoids ago()'s "just now" / minutes /
// absolute-date mix): "<1h ago" · "5h ago" · "3d ago".
function scannedAgo(iso: string): string {
  const h = Math.floor(Math.max(0, Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "<1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// A posting the watchlist scan surfaced and that's awaiting your triage (glance → review/matched).
export type Scanned = { id: number; company: string; title: string; location: string | null; scannedAt: string; postedAt: string | null };

// Short posted date (e.g. "Jul 20") — the ATS's published/updated date, when the scan captured one.
function fmtPosted(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Pre-fit postings have no computed level, so infer a seniority from the title — a rough signal for
// deciding what's worth assessing. "—" when the title gives nothing away.
function levelFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (/\bprincipal\b|\bl[78]\b/.test(t)) return "Principal";
  if (/\bstaff\b|\bl6\b/.test(t)) return "Staff";
  if (/\b(senior|sr\.?)\b|\bl5\b/.test(t)) return "Senior";
  if (/\b(junior|jr\.?|new ?grad|entry|l[34])\b/.test(t)) return "Junior";
  return "—";
}

// The Watchlist page's "Scan results" tab: new postings the scan found, which you add to Fit
// Assessment (single or multi-select) or discard. Add → POST queue-fit (moves the row to the fit
// queue + enqueues a fit job); Discard → the discard pile. Data + reload are owned by WatchlistView
// (so the tab can badge the count).
export default function ScanResults({ rows, reload }: { rows: Scanned[] | null; reload: () => void }) {
  const { bump } = useAgentQueue();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const act = async (targetIds: number[], action: "queue-fit" | "discard") => {
    if (!targetIds.length || busy) return;
    setBusy(true);
    try {
      await Promise.all(targetIds.map((id) =>
        fetch(`/api/scanned/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) })));
      if (action === "queue-fit") bump(); // handed work to the fit agent — pulse the queue
    } finally {
      setSel(new Set());
      reload();
      setBusy(false);
    }
  };

  if (rows === null)
    return <div className="flex items-center gap-2 px-6 py-8 text-[13px] text-zinc-500"><Loader2 size={14} className="animate-spin" /> loading…</div>;
  if (rows.length === 0)
    return (
      <div className="px-6 py-16 text-center text-[13px] text-zinc-500">
        No new scan results. Postings your watchlist scan surfaces show up here to triage into Fit Assessment.
      </div>
    );

  const ids = rows.map((r) => r.id);
  const allSelected = sel.size === ids.length;
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selIds = [...sel];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-6 py-3">
        <span className="truncate text-[13px] text-zinc-500">{rows.length} new posting{rows.length === 1 ? "" : "s"} — add to Fit Assessment or discard</span>
        {selIds.length > 0 && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="text-[12px] text-zinc-500">{selIds.length} selected</span>
            <button
              onClick={() => act(selIds, "queue-fit")}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/90 px-2.5 py-1.5 text-[13px] font-medium text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Add to Fit Assessment
            </button>
            <button
              onClick={() => act(selIds, "discard")}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-zinc-400 ring-1 ring-inset ring-zinc-800 transition hover:text-rose-300 hover:ring-zinc-700 disabled:opacity-50"
            >
              <X size={13} /> Discard
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
          <thead>
            <tr className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              <th className="w-8 pb-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => setSel(allSelected ? new Set() : new Set(ids))}
                  className="accent-emerald-500"
                  title={allSelected ? "Deselect all" : "Select all"}
                />
              </th>
              <th className="pb-2 pr-4">Company</th>
              <th className="pb-2 pr-4">Title</th>
              <th className="pb-2 pr-4">Location</th>
              <th className="pb-2 pr-4">Level</th>
              <th className="pb-2 pr-4">Posted</th>
              <th className="pb-2 pr-4">Scanned</th>
              <th className="pb-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="group border-t border-zinc-800/60 hover:bg-zinc-900/40">
                <td className="py-2 align-middle">
                  <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="accent-emerald-500" />
                </td>
                <td className="py-2 pr-4 align-middle font-medium text-zinc-200">{r.company}</td>
                <td className="py-2 pr-4 align-middle text-zinc-300">{r.title}</td>
                <td className="py-2 pr-4 align-middle text-zinc-400">{r.location ?? "—"}</td>
                <td className="py-2 pr-4 align-middle text-zinc-400">{levelFromTitle(r.title)}</td>
                <td className="py-2 pr-4 align-middle text-zinc-400" title={r.postedAt ?? undefined}>{r.postedAt ? fmtPosted(r.postedAt) : "—"}</td>
                <td className="py-2 pr-4 align-middle text-zinc-500" title={r.scannedAt}>{scannedAgo(r.scannedAt)}</td>
                <td className="py-2 align-middle text-right">
                  <div className="inline-flex items-center gap-1">
                    <button
                      onClick={() => act([r.id], "queue-fit")}
                      disabled={busy}
                      title="Add to Fit Assessment"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 transition hover:bg-emerald-500/15 disabled:opacity-50"
                    >
                      <Sparkles size={12} /> Add to fit
                    </button>
                    <button
                      onClick={() => act([r.id], "discard")}
                      disabled={busy}
                      title="Discard"
                      className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-rose-300 disabled:opacity-50"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
