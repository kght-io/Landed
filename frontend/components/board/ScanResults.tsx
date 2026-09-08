"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, ChevronRight, ChevronDown, Trash2, X, ExternalLink, FileText } from "lucide-react";
import { useAgentQueue } from "@/components/AgentQueueProvider";
import DiscardMenu, { DiscardButton } from "@/components/board/DiscardMenu";
import { anchorFrom } from "@/components/Popover";
import type { DismissReason } from "@landed/shared/jobs/dismiss";
import { groupByCompany } from "@landed/shared/pipeline/scan-funnel";
import { jdBlocks } from "@landed/shared/jobs/jd";

// Consistent hour/day relative time for the "Scanned" column (avoids ago()'s "just now" / minutes /
// absolute-date mix): "<1h ago" · "5h ago" · "3d ago".
function scannedAgo(iso: string): string {
  const h = Math.floor(Math.max(0, Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "<1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// A posting the watchlist scan surfaced and that's awaiting your triage (glance → review/matched).
export type Scanned = {
  id: number;
  company: string;
  title: string;
  location: string | null;
  url: string | null; // the ATS posting — the title links out to it
  scannedAt: string;
  postedAt: string | null;
  // Stage 2's output. `glanceRank` is the ranker's position within THIS company's board; null means
  // it was never ranked (the row predates the ranker, or the agent omitted a number) — which is not
  // the same as coming last. `glanceBands` is the level call, and more than one band means the
  // ladder couldn't separate them so the posting was KEPT rather than judged out of band.
  glanceRank?: number | null;
  glanceBands?: string[];
};

// Short posted date (e.g. "Jul 20") — the ATS's published/updated date, when the scan captured one.
function fmtPosted(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Fallback seniority guess for rows the ranker never levelled — a rough read off the title, which is
// exactly the weak signal stage 2 exists to replace. Shown only when there's no real band.
function levelFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (/\bprincipal\b|\bl[78]\b/.test(t)) return "Principal";
  if (/\bstaff\b|\bl6\b/.test(t)) return "Staff";
  if (/\b(senior|sr\.?)\b|\bl5\b/.test(t)) return "Senior";
  if (/\b(junior|jr\.?|new ?grad|entry|l[34])\b/.test(t)) return "Junior";
  return "—";
}

// Read the JD without leaving the page. The scan already fetched and stored it (7–11k chars per
// posting), so this is a local read, not a round trip to the ATS — and it exists because the ATS
// link often lands on a bare application form with the description nowhere in sight.
//
// Lazy on purpose: a company board can hold 90 postings and ~10k chars each, so loading every JD to
// render a list nobody has expanded would be megabytes for nothing. Fetched on first open, then kept.
function JdPeek({ id }: { id: number }) {
  const [jd, setJd] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // A ref, not state, so the fetch fires exactly once without a synchronous setState in the effect
  // body (which triggers cascading renders — the react-hooks rule this repo is burning down).
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Deliberately NO cleanup flag here. Under StrictMode the effect runs twice — mount, cleanup,
    // mount — and the ref guard means only the FIRST run fetches. A `live` flag cleared by that
    // first run's cleanup would then disable the only setter there is, and the panel would spin
    // forever. The ref already guarantees a single request, so there is nothing left to cancel.
    fetch(`/api/scanned/${id}`)
      .then((r) => r.json())
      .then((d) => setJd(typeof d.jd === "string" ? d.jd.trim() : ""))
      .catch(() => setFailed(true));
  }, [id]);

  // Derived, not stored: nothing back yet and no error means still in flight.
  const loading = jd === null && !failed;
  // Typed blocks rather than one pre-wrapped string. Rendering the raw text gave every line the same
  // weight, which is what made these read as a wall — headings, prose and bullets all identical.
  const blocks = jd ? jdBlocks(jd) : [];
  return (
    <div className="mb-2 ml-6 max-h-96 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/40 px-5 py-4 text-[12.5px] leading-relaxed text-zinc-400">
      {loading && <span className="inline-flex items-center gap-1.5 text-zinc-500"><Loader2 size={12} className="animate-spin" /> loading the description…</span>}
      {failed && <span className="text-rose-300/80">Couldn&apos;t load the description.</span>}
      {jd === "" && <span className="text-zinc-500">No description stored for this posting — the scan didn&apos;t capture one. Open the posting to read it.</span>}
      {blocks.map((b, i) =>
        b.type === "ul" ? (
          <ul key={i} className="my-2 list-disc space-y-1 pl-5 marker:text-zinc-600">
            {b.items.map((it, j) => <li key={j}>{it}</li>)}
          </ul>
        ) : b.type === "h" ? (
          // First block sits flush; later headings get air above so sections separate.
          <h4 key={i} className={`text-[12.5px] font-semibold text-zinc-200 ${i === 0 ? "" : "mt-4"}`}>{b.text}</h4>
        ) : (
          <p key={i} className="my-2">{b.text}</p>
        ),
      )}
    </div>
  );
}

type Funnel = {
  fetched: number; mechanical: number; glance: number; you: number; unattributed: number;
  triage: number; fit: number; applied: number; levelled: number; widened: number;
};

// Where postings died on the way here — the one thing this screen can't tell you by being looked at.
// You can count what's in front of you; you can't count what was removed before it arrived.
function FunnelLine() {
  const [f, setF] = useState<Funnel | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/scanned?funnel=1")
      .then((r) => r.json())
      .then((j) => { if (live) setF(j.funnel ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (!f) return null;
  const step = (label: string, n: number) => (
    <span className="whitespace-nowrap">
      <span className="tabular-nums text-zinc-300">{n.toLocaleString()}</span> <span className="text-zinc-600">{label}</span>
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-6 pb-2 text-[11px] text-zinc-500">
      {step("scanned", f.fetched)}
      <span className="text-zinc-700">→</span>
      {step("cut by filter", f.mechanical)}
      <span className="text-zinc-700">→</span>
      {/* The agent's drops and yours both land in `dismissed`, so these were one number until the
          markers were used to tell them apart — and it read as 1,181 hand-discards against your
          actual 23. Kept separate because they say different things: one is the pipeline working,
          the other is it failing. */}
      {step("cut at glance", f.glance)}
      <span className="text-zinc-700">→</span>
      {step("here", f.triage)}
      <span className="text-zinc-700">→</span>
      {step("you discarded", f.you)}
      <span className="text-zinc-700">→</span>
      {step("in fit", f.fit)}
      <span className="text-zinc-700">→</span>
      {step("applied", f.applied)}
      {f.levelled > 0 && (
        <span
          className="ml-1 whitespace-nowrap text-zinc-600"
          title="Postings whose level call kept every band it might be instead of guessing one. That refusal is what stopped them being dropped — counted here so it isn't invisible."
        >
          · {f.widened} of {f.levelled} levelled kept wide
        </span>
      )}
    </div>
  );
}

// The Watchlist page's "Scan results" tab. Grouped by company, collapsible, ranked within each
// group by stage 2c.
//
// The redesign this is: a row you haven't acted on is no longer a to-do. Before, this tab was a flat
// list you cleared by hand, and clearing a 90-posting Anthropic board one row at a time is precisely
// what produced 203 hand-discards. Now you open a company, take the top one or two, and collapse it
// — the rest are not debt, and discarding becomes deliberate rather than janitorial.
//
// Data + reload are owned by WatchlistView (so the tab can badge the count).
export default function ScanResults({ rows, reload }: { rows: Scanned[] | null; reload: () => void }) {
  const { bump } = useAgentQueue();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  // Collapsed by default — that IS the feature. A company you never opened isn't an outstanding task.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [bulkPos, setBulkPos] = useState<{ x: number; y: number } | null>(null);
  // Which rows have their JD open. Per-row rather than one-at-a-time: comparing two postings at a
  // company is exactly the judgement this screen is for.
  const [openJd, setOpenJd] = useState<Set<number>>(new Set());
  const toggleJd = (id: number) =>
    setOpenJd((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const act = async (targetIds: number[], action: "queue-fit" | "discard", reason?: DismissReason) => {
    if (!targetIds.length || busy) return;
    setBusy(true);
    try {
      await Promise.all(targetIds.map((id) =>
        fetch(`/api/scanned/${id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, reason }),
        })));
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

  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroup = (company: string) =>
    setExpanded((prev) => { const n = new Set(prev); if (n.has(company)) n.delete(company); else n.add(company); return n; });
  const selIds = [...sel];
  const groups = groupByCompany(rows);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-6 pb-1 pt-3">
        <span className="truncate text-[13px] text-zinc-500">
          {rows.length} posting{rows.length === 1 ? "" : "s"} across {groups.length} compan{groups.length === 1 ? "y" : "ies"} — open one, take the top, move on
        </span>
      </div>

      <FunnelLine />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {groups.map((g) => {
          const open = expanded.has(g.company);
          const gIds = g.rows.map((r) => r.id);
          const allInGroup = gIds.every((id) => sel.has(id));
          return (
            <div key={g.company} className="border-b border-zinc-800/60 last:border-b-0">
              <div className="flex items-center gap-2 py-2">
                <input
                  type="checkbox"
                  checked={allInGroup}
                  onChange={() =>
                    setSel((prev) => {
                      const n = new Set(prev);
                      if (allInGroup) gIds.forEach((id) => n.delete(id));
                      else gIds.forEach((id) => n.add(id));
                      return n;
                    })
                  }
                  className="accent-emerald-500"
                  title={allInGroup ? "Deselect this company" : "Select this company"}
                />
                <button onClick={() => toggleGroup(g.company)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {open
                    ? <ChevronDown size={14} className="shrink-0 text-zinc-500" />
                    : <ChevronRight size={14} className="shrink-0 text-zinc-500" />}
                  <span className="shrink-0 font-medium text-zinc-200">{g.company}</span>
                  <span className="shrink-0 tabular-nums text-[12px] text-zinc-500">{g.count}</span>
                  {!open && <span className="truncate text-[12px] text-zinc-500">· top: {g.top}</span>}
                </button>
              </div>

              {open && (
                <table className="mb-2 w-full border-separate border-spacing-0 text-left text-[13px]">
                  <tbody>
                    {g.rows.map((r) => (
                      <Fragment key={r.id}>
                      <tr className="group border-t border-zinc-800/40 hover:bg-zinc-900/40">
                        <td className="w-8 py-2 pl-6 align-middle">
                          <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="accent-emerald-500" />
                        </td>
                        {/* "—" for an unranked row, never a number: it means the ranker never saw it,
                            not that it came last. */}
                        <td className="w-8 py-2 pr-3 text-right align-middle tabular-nums text-[12px] text-zinc-600">
                          {r.glanceRank ?? "—"}
                        </td>
                        <td className="py-2 pr-4 align-middle text-zinc-300">
                          {r.url ? (
                            // Opens the real posting. `noopener` because these are third-party ATS
                            // pages; stopPropagation so clicking through never also toggles the row.
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              onClick={(e) => e.stopPropagation()}
                              title={r.url}
                              className="group/link inline-flex items-center gap-1 transition hover:text-emerald-300"
                            >
                              {r.title}
                              <ExternalLink size={11} className="opacity-0 transition group-hover/link:opacity-70" />
                            </a>
                          ) : (
                            r.title
                          )}
                        </td>
                        <td className="py-2 pr-4 align-middle text-zinc-400">{r.location ?? "—"}</td>
                        <td className="py-2 pr-4 align-middle text-zinc-400">
                          {r.glanceBands?.length ? (
                            <span
                              title={r.glanceBands.length > 1
                                ? "The company's ladder couldn't separate these, so the posting was kept rather than judged out of band."
                                : undefined}
                              className={r.glanceBands.length > 1 ? "text-zinc-500" : undefined}
                            >
                              {r.glanceBands.join(" / ")}
                            </span>
                          ) : (
                            levelFromTitle(r.title)
                          )}
                        </td>
                        <td className="py-2 pr-4 align-middle text-zinc-400" title={r.postedAt ?? undefined}>{r.postedAt ? fmtPosted(r.postedAt) : "—"}</td>
                        <td className="py-2 pr-4 align-middle text-zinc-500" title={r.scannedAt}>{scannedAgo(r.scannedAt)}</td>
                        <td className="py-2 text-right align-middle">
                          <span className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => toggleJd(r.id)}
                              title={openJd.has(r.id) ? "Hide the description" : "Read the description — already stored, no trip to the ATS"}
                              className={`rounded-md p-1 ring-1 ring-inset transition ${openJd.has(r.id) ? "bg-zinc-800 text-zinc-200 ring-zinc-700" : "text-zinc-500 ring-zinc-800 hover:bg-zinc-800 hover:text-zinc-200"}`}
                            >
                              <FileText size={14} />
                            </button>
                            <button
                              onClick={() => act([r.id], "queue-fit")}
                              disabled={busy}
                              title="Add to Fit Assessment"
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 transition hover:bg-emerald-500/15 disabled:opacity-50"
                            >
                              <Sparkles size={12} /> Add to fit
                            </button>
                            {/* One-click discard is back, but it goes through the reason menu — the
                                convenience is restored without reopening the unlabelled path. */}
                            <DiscardButton
                              disabled={busy}
                              onPick={(reason) => act([r.id], "discard", reason)}
                              render={(open, isOpen) => (
                                <button
                                  onClick={open}
                                  disabled={busy}
                                  title="Discard as — pick a reason"
                                  className={`rounded-md p-1 ring-1 ring-inset transition disabled:opacity-50 ${isOpen ? "bg-rose-500/15 text-rose-300 ring-rose-900/60" : "text-zinc-500 ring-zinc-800 hover:bg-rose-500/15 hover:text-rose-300"}`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            />
                          </span>
                        </td>
                      </tr>
                      {openJd.has(r.id) && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <JdPeek id={r.id} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating bulk bar — same shape as the Pipeline's, so selecting rows behaves the same way
          on both screens. `Discard as` opens the reason menu rather than discarding immediately:
          bulk-select naturally groups rows that share a reason, which is what makes a batch label
          honest, and one extra click on a whole batch is cheap. */}
      {selIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
          <div className="flex items-center gap-1.5 rounded-2xl border border-zinc-700 bg-zinc-900/95 px-3 py-2 shadow-2xl shadow-black/50 ring-1 ring-white/5 backdrop-blur">
            <span className="rounded-lg bg-sky-500/15 px-2 py-1 text-[12px] font-semibold tabular-nums text-sky-200">{selIds.length} selected</span>
            <span className="mx-0.5 h-5 w-px bg-zinc-700" />
            <button
              onClick={() => act(selIds, "queue-fit")}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-sky-200 transition hover:bg-sky-500/15 disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Add to fit
            </button>
            <button
              onClick={(e) => setBulkPos(bulkPos ? null : anchorFrom(e))}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-rose-200 transition hover:bg-rose-500/15 disabled:opacity-50"
            >
              <Trash2 size={13} /> Discard as
            </button>
            {bulkPos && (
              <DiscardMenu
                at={bulkPos}
                onPick={(r) => act(selIds, "discard", r)}
                onClose={() => setBulkPos(null)}
              />
            )}
            <button
              onClick={() => setSel(new Set())}
              title="Clear selection"
              className="ml-0.5 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
