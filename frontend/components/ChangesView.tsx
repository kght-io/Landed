"use client";

import { useEffect, useMemo, useState } from "react";
import { User, Bot, AlertTriangle, Check, X, Loader2, Mail, Search, ChevronRight } from "lucide-react";
import type { Posting } from "@landed/shared/types";
import { ago } from "@landed/shared/format";
import { actorLabel, sourceLabel } from "@/components/jobMeta";
import { describeChange, type DescribedChange } from "@landed/shared/change-format";

type EventView = {
  id: number;
  ts: string;
  actor: string;
  source: string;
  entity: string;
  entityId: number | null;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  summary: string | null;
};
type Actor = "You" | "CoWork";

type PendingMatch = {
  id: number;
  createdAt: string;
  kind: "match" | "unbound" | "change";
  companyName: string;
  detail?: string; // unbound: a "couldn't bind" message
  incoming: { role: string | null; status: string; note: string | null; appliedDate: string | null };
  candidates: { id: number; role: string | null; status: string; appliedDate: string | null }[];
  // change: what an inbox sync wants to do, already in plain English (see lib/change-format).
  changes?: DescribedChange[];
  create?: boolean; // approving creates the posting rather than editing one
  role?: string | null;
};

const ACTOR_META: Record<string, { icon: typeof User; cls: string; ring: string }> = {
  You: { icon: User, cls: "text-sky-300", ring: "bg-sky-500/15" },
  CoWork: { icon: Bot, cls: "text-violet-300", ring: "bg-violet-500/15" },
};

// Display labels (actorLabel/sourceLabel): the audit log surfaces the automated actor/source as
// "Agent"/"agent" while the data still stores the legacy "CoWork"/"cowork" (so filters, batching, and
// ACTOR_META keep keying off it). Shared with the queue/monitor so no render site shows the codename.

// Color-coded verb chips. Keyed by the *humanized* verb so glance verdicts get their own
// colors (dropped/queued/review) instead of a generic "updated".
const VERB_CLS: Record<string, string> = {
  added: "text-emerald-300 ring-emerald-500/25 bg-emerald-500/10",
  removed: "text-rose-300 ring-rose-500/25 bg-rose-500/10",
  updated: "text-sky-300 ring-sky-500/25 bg-sky-500/10",
  flagged: "text-amber-300 ring-amber-500/25 bg-amber-500/10",
  merged: "text-violet-300 ring-violet-500/25 bg-violet-500/10",
  kept: "text-zinc-300 ring-zinc-600/40 bg-zinc-700/30",
  queued: "text-emerald-300 ring-emerald-500/25 bg-emerald-500/10",
  dropped: "text-rose-300 ring-rose-500/25 bg-rose-500/10",
  review: "text-amber-300 ring-amber-500/25 bg-amber-500/10",
};
const verbCls = (l: string) => VERB_CLS[l] ?? "text-zinc-300 ring-zinc-600/40 bg-zinc-700/30";

const ACTION_LABEL: Record<string, string> = {
  insert: "added", delete: "removed", update: "updated", flag: "flagged", merge: "merged", preserve: "kept",
};

// Event type categories for the feed tabs. An "application status update" is an inbox-sync event
// (the automated status/date sync) or any direct change to a posting's `status` field (a manual
// stage move); everything else is "other".
type TypeFilter = "all" | "status" | "other";
const isStatusUpdate = (e: EventView): boolean => e.source === "inbox-sync" || e.field === "status";
const matchesType = (e: EventView, t: TypeFilter): boolean =>
  t === "all" ? true : t === "status" ? isStatusUpdate(e) : !isStatusUpdate(e);
const TYPE_TABS: { id: TypeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "status", label: "Application status" },
  { id: "other", label: "Other" },
];

// Turn a raw event into a scannable shape: a colored verb, the company/role it touched,
// and a plain-English description of what actually changed. Summaries follow the shape
// `Company — Role · detail`, so we split on those separators and humanize known jargon
// (notably the agent's `glance:high|low|drop` discovery verdicts).
type Described = {
  verb: { label: string; cls: string };
  company: string | null;
  role: string | null;
  detail: string | null;
};
function describe(e: EventView): Described {
  const summary = e.summary ?? "";
  const sep = summary.indexOf(" · ");
  const subject = sep === -1 ? summary : summary.slice(0, sep);
  const rest = sep === -1 ? "" : summary.slice(sep + 3);
  const dash = subject.indexOf(" — ");
  const company = (dash === -1 ? subject : subject.slice(0, dash)).trim() || null;
  const role = dash === -1 ? null : subject.slice(dash + 3).trim() || null;

  const g = rest.match(/glance:(high|low|drop)/);
  if (g) {
    if (g[1] === "high") return { verb: { label: "queued", cls: verbCls("queued") }, company, role, detail: "Strong match — queued for fit" };
    if (g[1] === "low") return { verb: { label: "review", cls: verbCls("review") }, company, role, detail: "Weak match — needs your review" };
    return { verb: { label: "dropped", cls: verbCls("dropped") }, company, role, detail: "Dropped from discovery" };
  }

  const label = ACTION_LABEL[e.action] ?? e.action;
  // A field-level event carries the change structurally (field + old + new), so say it in English
  // rather than echoing the stored shorthand ("status applied→interview", "appliedDate ∅→2026-06-25").
  const detail = e.field
    ? describeChange({ field: e.field, old: e.oldValue ?? undefined, new: e.newValue ?? undefined }).text
    : rest || null;
  return { verb: { label, cls: verbCls(label) }, company, role, detail };
}

// Human day label for the sticky group header.
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString([], { month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

// Within a day, collapse a run of 3+ consecutive events that share an actor + source and
// land close in time (a single automated run — discovery's 100s of glance verdicts, an mcp
// curation sweep, an inbox sync) into one batch node. One-off edits stay as plain rows.
// Batching keys off source, not actor: discovery's glance verdicts are logged as You but
// are still a bulk machine run, so an actor filter would miss exactly the flood we want to fold.
// Items arrive newest-first.
type FeedNode =
  | { kind: "event"; e: EventView }
  | { kind: "multi"; key: string; source: string; actor: string; items: EventView[] }
  | { kind: "batch"; key: string; source: string; actor: string; items: EventView[] };
const BATCH_GAP_MS = 20 * 60 * 1000;
const withinGap = (a: EventView, b: EventView) =>
  new Date(a.ts).getTime() - new Date(b.ts).getTime() <= BATCH_GAP_MS;
// Two events touch the SAME record — same entity type + id. Used to fold one save that changed
// several fields (e.g. an apply: status + note + source + channel + team + level) into one card.
const sameEntity = (a: EventView, b: EventView) =>
  a.entityId != null && a.entityId === b.entityId && a.entity === b.entity;

// Fold consecutive field-updates to the SAME record into one "multi" node (a card with a bullet per
// field); everything else stays a plain event. No flood-collapsing — used to group the rows INSIDE an
// expanded batch, so a posting's multi-field save reads as one card, not scattered rows.
function groupMulti(items: EventView[]): FeedNode[] {
  const nodes: FeedNode[] = [];
  let i = 0;
  while (i < items.length) {
    const e = items[i];
    if (e.action === "update" && e.field) {
      let j = i + 1;
      while (
        j < items.length &&
        sameEntity(items[j], e) &&
        items[j].action === "update" && items[j].field &&
        withinGap(items[j - 1], items[j])
      ) j++;
      if (j - i >= 2) {
        nodes.push({ kind: "multi", key: `m${e.id}`, source: e.source, actor: e.actor, items: items.slice(i, j) });
        i = j;
        continue;
      }
    }
    nodes.push({ kind: "event", e });
    i++;
  }
  return nodes;
}

function batchify(items: EventView[]): FeedNode[] {
  const nodes: FeedNode[] = [];
  let i = 0;
  while (i < items.length) {
    const e = items[i];
    // 1) A run of FIELD updates to the SAME record (one multi-field save) → a single "multi" card
    // listing each field change. Requires a real `field` diff, so glance/summary-only floods (which
    // share a company entityId but aren't field edits) fall through to the generic batch below.
    if (e.action === "update" && e.field) {
      let j = i + 1;
      while (
        j < items.length &&
        sameEntity(items[j], e) &&
        items[j].actor === e.actor && items[j].source === e.source &&
        items[j].action === "update" && items[j].field &&
        withinGap(items[j - 1], items[j])
      ) j++;
      if (j - i >= 2) {
        nodes.push({ kind: "multi", key: `m${e.id}`, source: e.source, actor: e.actor, items: items.slice(i, j) });
        i = j;
        continue;
      }
    }
    // 2) A flood of 3+ consecutive events from one automated run (across many records) → collapsed.
    let j = i + 1;
    while (
      j < items.length &&
      items[j].actor === e.actor &&
      items[j].source === e.source &&
      withinGap(items[j - 1], items[j])
    ) j++;
    if (j - i >= 3) {
      nodes.push({ kind: "batch", key: `b${e.id}`, source: e.source, actor: e.actor, items: items.slice(i, j) });
      i = j;
      continue;
    }
    nodes.push({ kind: "event", e });
    i++;
  }
  return nodes;
}

// Group an already-sorted (newest-first) event list into day buckets of feed nodes.
function groupByDay(list: EventView[]): { key: string; label: string; nodes: FeedNode[] }[] {
  const groups: { key: string; label: string; items: EventView[] }[] = [];
  for (const e of list) {
    const key = new Date(e.ts).toDateString();
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: dayLabel(e.ts), items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }
  return groups.map((g) => ({ key: g.key, label: g.label, nodes: batchify(g.items) }));
}

// One event as a timeline row. `nested` trims the avatar for rows inside an expanded batch.
function EventRow({ e, nested }: { e: EventView; nested?: boolean }) {
  const m = ACTOR_META[e.actor] ?? ACTOR_META.CoWork;
  const Icon = m.icon;
  const d = describe(e);
  const hasChange = !!(e.field || e.oldValue != null || e.newValue != null);
  return (
    <li className="relative flex items-start gap-3 rounded-lg px-1 py-2.5 hover:bg-zinc-900/40">
      {nested ? (
        <span className="relative z-[1] mt-1 ml-[7px] h-2 w-2 shrink-0 rounded-full bg-zinc-700 ring-2 ring-zinc-950" />
      ) : (
        <span className={`relative z-[1] mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ring-zinc-950 ${m.ring}`}>
          <Icon size={13} className={m.cls} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {/* [time] Actor verb [Company — Role]: */}
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm leading-relaxed">
          <span className="shrink-0 text-[12px] text-zinc-500">{ago(e.ts, { absolute: true })}</span>
          <span className={`font-medium ${m.cls}`}>{actorLabel(e.actor)}</span>
          <span className="text-zinc-400">{d.verb.label}</span>
          {d.company ? (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-medium text-zinc-100">
              {d.company}{d.role ? ` — ${d.role}` : ""}
            </span>
          ) : (
            <span className="font-medium text-zinc-100">{e.summary}</span>
          )}
          {(hasChange || (d.company && d.detail)) && <span className="text-zinc-500">:</span>}
        </div>

        {/* what changed: prefer the structured "field from old to new"; else the humanized detail */}
        {hasChange ? (
          <div className="mt-1.5 ml-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-zinc-500">
            <span className="text-zinc-600">•</span>
            {e.field && <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-medium text-zinc-300">{e.field}</span>}
            {(e.oldValue != null || e.newValue != null) && (
              <>
                <span>from</span>
                <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-300/90 line-through decoration-rose-400/40">
                  {e.oldValue ?? "∅"}
                </span>
                <span>to</span>
                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300/90">{e.newValue ?? "∅"}</span>
              </>
            )}
          </div>
        ) : (
          d.company && d.detail && <p className="mt-1 ml-0.5 text-[13px] text-zinc-400">• {d.detail}</p>
        )}
      </div>
    </li>
  );
}

// One save that changed several fields on a single record, rendered as ONE card: the actor/verb/
// subject header, then a bullet per field change. Always expanded — the whole point is to read the
// fields at a glance — so no toggle (unlike the flood BatchRow).
function MultiRow({ node, nested }: { node: Extract<FeedNode, { kind: "multi" }>; nested?: boolean }) {
  const m = ACTOR_META[node.actor] ?? ACTOR_META.CoWork;
  const Icon = m.icon;
  const d = describe(node.items[0]);
  return (
    <li className="relative flex items-start gap-3 rounded-lg px-1 py-2.5 hover:bg-zinc-900/40">
      {nested ? (
        <span className="relative z-[1] mt-1 ml-[7px] h-2 w-2 shrink-0 rounded-full bg-zinc-700 ring-2 ring-zinc-950" />
      ) : (
        <span className={`relative z-[1] mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ring-zinc-950 ${m.ring}`}>
          <Icon size={13} className={m.cls} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {/* [time] Actor updated [Company — Role]: */}
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm leading-relaxed">
          <span className="shrink-0 text-[12px] text-zinc-500">{ago(node.items[0].ts, { absolute: true })}</span>
          <span className={`font-medium ${m.cls}`}>{actorLabel(node.actor)}</span>
          <span className="text-zinc-400">{d.verb.label}</span>
          {d.company ? (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-medium text-zinc-100">
              {d.company}{d.role ? ` — ${d.role}` : ""}
            </span>
          ) : (
            <span className="font-medium text-zinc-100">{node.items[0].summary}</span>
          )}
          <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[11px] font-medium text-zinc-400">{node.items.length} fields</span>
          <span className="text-zinc-500">:</span>
        </div>

        {/* one bullet per changed field */}
        <ul className="mt-1.5 ml-0.5 space-y-1">
          {node.items.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-1.5 text-[13px] text-zinc-500">
              <span className="text-zinc-600">•</span>
              {e.field && <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-medium text-zinc-300">{e.field}</span>}
              {(e.oldValue != null || e.newValue != null) && (
                <>
                  <span>from</span>
                  <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-300/90 line-through decoration-rose-400/40">{e.oldValue ?? "∅"}</span>
                  <span>to</span>
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300/90">{e.newValue ?? "∅"}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

// A collapsed run of agent events. The header summarizes the run (count + verb breakdown);
// expanding reveals the individual rows.
function BatchRow({ node, open, onToggle }: { node: Extract<FeedNode, { kind: "batch" }>; open: boolean; onToggle: () => void }) {
  const m = ACTOR_META[node.actor] ?? ACTOR_META.CoWork;
  const Icon = m.icon;
  const breakdown = useMemo(() => {
    const counts = new Map<string, { n: number; cls: string }>();
    for (const e of node.items) {
      const v = describe(e).verb;
      const cur = counts.get(v.label) ?? { n: 0, cls: v.cls };
      counts.set(v.label, { n: cur.n + 1, cls: v.cls });
    }
    return [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [node.items]);
  const newest = node.items[0].ts;
  // Single representative verb for the collapsed header — the most common one in the run.
  const verb = breakdown[0]?.[0] ?? "updated";

  return (
    <li className="relative">
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 rounded-lg px-1 py-2.5 text-left transition hover:bg-zinc-900/40"
      >
        <span className={`relative z-[1] mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ring-zinc-950 ${m.ring}`}>
          <Icon size={13} className={m.cls} />
        </span>
        <div className="min-w-0 flex-1">
          {/* [time] Actor verb XX [source] actions */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
            <ChevronRight size={14} className={`shrink-0 text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`} />
            <span className="text-[12px] text-zinc-500">{ago(newest, { absolute: true })}</span>
            <span className={`font-medium ${m.cls}`}>{actorLabel(node.actor)}</span>
            <span className="text-zinc-400">{verb}</span>
            <span className="font-medium text-zinc-100">{node.items.length}</span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[12px] text-zinc-400">{sourceLabel(node.source)}</span>
            <span className="text-zinc-400">actions</span>
          </div>
        </div>
      </button>
      {open && (
        <ol className="ml-9 border-l border-zinc-800/70 pl-2">
          {/* Group each record's multi-field save into one card (bullets per field) even inside the batch. */}
          {groupMulti(node.items).map((n) =>
            n.kind === "multi" ? <MultiRow key={n.key} node={n} nested />
              : n.kind === "event" ? <EventRow key={n.e.id} e={n.e} nested />
              : null
          )}
        </ol>
      )}
    </li>
  );
}

export default function ChangesView() {
  const [events, setEvents] = useState<EventView[]>([]);
  const [review, setReview] = useState<Posting[]>([]);
  const [matches, setMatches] = useState<PendingMatch[]>([]);
  const [filter, setFilter] = useState<Actor | "all">("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const [openBatches, setOpenBatches] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const d = await fetch("/api/events").then((r) => r.json());
    setEvents(d.events ?? []);
    setReview(d.needsReview ?? []);
    setMatches(d.pendingMatches ?? []);
    setLoading(false);
  }
  useEffect(() => {
    // Fetch-on-mount loader; its setState runs post-await (async), not synchronously, so it doesn't
    // cause the cascading render the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function resolve(id: string, decision: "confirm" | "reject") {
    setBusy(id + decision);
    await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: Number(id), decision }),
    });
    await load();
    setBusy(null);
  }

  const postMatch = (id: number, decision: "apply" | "new" | "dismiss", appId?: number) =>
    fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision, appId }),
    });

  async function resolveMatch(id: number, decision: "apply" | "new" | "dismiss", appId?: number) {
    setBusy(`m${id}-${decision}-${appId ?? ""}`);
    await postMatch(id, decision, appId);
    await load();
    setBusy(null);
  }

  // Approving a proposed change = running the merge the sync held back; a proposed CREATE has no
  // posting to merge onto, so it resolves as "new" instead.
  const approveChange = (m: PendingMatch) =>
    resolveMatch(m.id, m.create ? "new" : "apply", m.create ? undefined : m.candidates[0]?.id);

  // Approve every proposal in one go. Sequential (each merge reads the row it's about to write) with
  // a single reload at the end, so the list doesn't flicker item by item.
  async function approveAllChanges(items: PendingMatch[]) {
    setBusy("approve-all");
    for (const m of items) await postMatch(m.id, m.create ? "new" : "apply", m.create ? undefined : m.candidates[0]?.id);
    await load();
    setBusy(null);
  }

  // Events narrowed by actor + search (but NOT type) — the base for both the type-tab counts and the
  // type-filtered feed, so each tab's count reflects the current actor/search context.
  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter(
      (e) =>
        (filter === "all" || e.actor === filter) &&
        (!q || `${e.summary ?? ""} ${e.source} ${e.actor} ${e.entity}`.toLowerCase().includes(q))
    );
  }, [events, filter, query]);
  const typeCounts = useMemo(() => {
    const status = scoped.filter(isStatusUpdate).length;
    return { all: scoped.length, status, other: scoped.length - status };
  }, [scoped]);
  const filtered = useMemo(() => scoped.filter((e) => matchesType(e, typeFilter)), [scoped, typeFilter]);
  const groups = useMemo(() => groupByDay(filtered), [filtered]);
  // Changes an inbox sync wants to make (approve/reject) vs. questions it can't answer itself
  // (which posting is this? / an unbound result). Different asks, so they get their own sections.
  const proposed = useMemo(() => matches.filter((m) => m.kind === "change"), [matches]);
  const questions = useMemo(() => matches.filter((m) => m.kind !== "change"), [matches]);
  // Everything awaiting your decision — pinned at the top until resolved.
  const actionCount = matches.length + review.length;

  return (
    <div className="relative flex h-full flex-col text-zinc-100">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-zinc-950/60 text-sm text-zinc-400 backdrop-blur-sm">
          <Loader2 size={16} className="animate-spin" /> loading…
        </div>
      )}

      <header className="border-b border-zinc-800/80 px-6 py-3.5">
        <h1 className="text-[15px] font-semibold tracking-tight">Changes</h1>
        <p className="mt-0.5 text-[13px] text-zinc-500">
          {actionCount > 0 && <><span className="font-medium text-amber-300">{actionCount} need your action</span> · </>}
          {events.length} events
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Needs your action — one pinned section grouping every item awaiting your decision. */}
          {actionCount > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-300" />
              <h2 className="text-sm font-semibold text-zinc-100">Needs your action ({actionCount})</h2>
              <span className="text-[12px] text-zinc-500">pinned until you resolve them</span>
            </div>
          {/* Proposed by an inbox sync — nothing here has touched your tracker yet. */}
          {proposed.length > 0 && (
            <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4">
              <div className="mb-1 flex items-center gap-2 text-emerald-300">
                <Mail size={15} />
                <h2 className="text-sm font-semibold">From your inbox ({proposed.length})</h2>
                <button
                  onClick={() => approveAllChanges(proposed)}
                  disabled={!!busy}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[13px] font-medium text-emerald-950 transition enabled:hover:bg-emerald-400 disabled:opacity-50"
                >
                  {busy === "approve-all" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Approve all
                </button>
              </div>
              <p className="mb-3 text-[12px] text-zinc-500">
                The agent read these out of your email. Nothing is applied until you approve it.
              </p>
              <div className="space-y-2.5">
                {proposed.map((m) => (
                  <div key={m.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {m.create && (
                            <span className="mr-1.5 rounded bg-emerald-500/15 px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                              New
                            </span>
                          )}
                          {m.companyName}
                          {m.role && <span className="font-normal text-zinc-400"> — {m.role}</span>}
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {m.create && (
                            <li className="text-[13px] text-zinc-300">
                              <span className="mr-1.5 text-zinc-600">•</span>
                              Add this posting to your tracker
                            </li>
                          )}
                          {(m.changes ?? []).map((c, i) => (
                            <li key={i} className="text-[13px] text-zinc-300">
                              <span className="mr-1.5 text-zinc-600">•</span>
                              <span className="text-zinc-500">{c.label}:</span>{" "}
                              {c.from && <span className="text-zinc-500 line-through">{c.from}</span>}
                              {c.from && <span className="mx-1 text-zinc-600">→</span>}
                              <span className="font-medium text-zinc-100">{c.to ?? "cleared"}</span>
                            </li>
                          ))}
                        </ul>
                        {m.incoming.note && (
                          <p className="mt-1.5 line-clamp-2 text-[12px] italic text-zinc-500">“{m.incoming.note}”</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5">
                        <button
                          onClick={() => approveChange(m)}
                          disabled={!!busy}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[13px] font-medium text-emerald-950 transition enabled:hover:bg-emerald-400 disabled:opacity-50"
                        >
                          {busy === `m${m.id}-${m.create ? "new" : "apply"}-${m.create ? "" : m.candidates[0]?.id ?? ""}` ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          Approve
                        </button>
                        <button
                          onClick={() => resolveMatch(m.id, "dismiss")}
                          disabled={!!busy}
                          className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-[13px] font-medium text-zinc-300 transition enabled:hover:bg-zinc-700 disabled:opacity-50"
                        >
                          {busy === `m${m.id}-dismiss-` ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Matches + unbound results — pick which posting an incoming change belongs to, or dismiss an alert */}
          {questions.length > 0 && (
            <section className="rounded-2xl border border-sky-500/30 bg-sky-500/[0.04] p-4">
              <div className="mb-3 flex items-center gap-2 text-sky-300">
                <AlertTriangle size={15} />
                <h2 className="text-sm font-semibold">Matches &amp; results ({questions.length})</h2>
              </div>
              <div className="space-y-2.5">
                {questions.map((m) => {
                  const inc = m.incoming;
                  // Unbound result (fit/tailor id-miss): an alert to look at — dismiss only.
                  if (m.kind === "unbound") {
                    return (
                      <div key={m.id} className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-3">
                        <p className="text-sm text-amber-200">{m.detail ?? `Unbound result at ${m.companyName}`}</p>
                        {m.candidates.length > 0 && (
                          <p className="mt-1 text-[13px] text-zinc-500">
                            Maybe meant: {m.candidates.map((c) => c.role ?? "—").join(", ")}
                          </p>
                        )}
                        <div className="mt-2 flex">
                          <button
                            onClick={() => resolveMatch(m.id, "dismiss")}
                            disabled={!!busy}
                            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-zinc-400 transition enabled:hover:text-zinc-200 disabled:opacity-50"
                          >
                            {busy === `m${m.id}-dismiss-` ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                            Dismiss
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={m.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                      <p className="text-sm">
                        Incoming <span className="font-medium text-sky-300">{inc.status}</span>
                        {inc.role && <> for <span className="font-medium">{inc.role}</span></>} at{" "}
                        <span className="font-medium">{m.companyName}</span>
                        {inc.appliedDate && <span className="text-zinc-500"> · {inc.appliedDate}</span>}
                      </p>
                      <p className="mt-0.5 text-[13px] text-zinc-500">Which posting does this belong to?</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.candidates.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => resolveMatch(m.id, "apply", c.id)}
                            disabled={!!busy}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2.5 py-1.5 text-[13px] transition enabled:hover:border-sky-500/50 enabled:hover:bg-sky-500/10 disabled:opacity-50"
                          >
                            {busy === `m${m.id}-apply-${c.id}` ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} className="text-sky-300" />}
                            <span className="font-medium">{c.role ?? "—"}</span>
                            <span className="text-zinc-500">· {c.status}{c.appliedDate ? ` · ${c.appliedDate}` : ""}</span>
                          </button>
                        ))}
                        <button
                          onClick={() => resolveMatch(m.id, "new")}
                          disabled={!!busy}
                          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-zinc-700 px-2.5 py-1.5 text-[13px] text-zinc-300 transition enabled:hover:border-emerald-500/50 enabled:hover:text-emerald-300 disabled:opacity-50"
                        >
                          {busy === `m${m.id}-new-` ? <Loader2 size={12} className="animate-spin" /> : "+ New posting"}
                        </button>
                        <button
                          onClick={() => resolveMatch(m.id, "dismiss")}
                          disabled={!!busy}
                          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-zinc-500 transition enabled:hover:text-zinc-300 disabled:opacity-50"
                        >
                          {busy === `m${m.id}-dismiss-` ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                          Dismiss
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Needs review */}
          {review.length > 0 && (
            <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-4">
              <div className="mb-3 flex items-center gap-2 text-amber-300">
                <AlertTriangle size={15} />
                <h2 className="text-sm font-semibold">Needs review ({review.length})</h2>
              </div>
              <div className="space-y-2">
                {review.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {p.company} <span className="font-normal text-zinc-400">— {p.role}</span>
                        {p.channel === "referral" && (
                          <span className="ml-1.5 rounded bg-sky-500/15 px-1 py-0.5 text-[11px] text-sky-300">referral</span>
                        )}
                      </p>
                      {p.note && <p className="mt-0.5 truncate text-[13px] text-zinc-500">{p.note}</p>}
                    </div>
                    <button
                      onClick={() => resolve(p.id, "confirm")}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[13px] font-medium text-emerald-950 transition enabled:hover:bg-emerald-400 disabled:opacity-50"
                    >
                      {busy === p.id + "confirm" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      Confirm applied
                    </button>
                    <button
                      onClick={() => resolve(p.id, "reject")}
                      disabled={!!busy}
                      className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-[13px] font-medium text-zinc-300 transition enabled:hover:bg-zinc-700 disabled:opacity-50"
                    >
                      {busy === p.id + "reject" ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                      Not submitted
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          </section>
          )}

          {/* Feed */}
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {/* Type tabs — categorize the feed by event kind (app status updates vs everything else). */}
              <div className="flex items-center gap-1 rounded-lg bg-zinc-900 p-0.5 ring-1 ring-inset ring-zinc-800">
                {TYPE_TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTypeFilter(t.id)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition ${
                      typeFilter === t.id ? "bg-sky-500/15 font-medium text-sky-200 ring-1 ring-inset ring-sky-500/30" : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {t.label}
                    <span className={`rounded px-1 text-[11px] tabular-nums ${typeFilter === t.id ? "bg-sky-500/20 text-sky-200" : "bg-zinc-800 text-zinc-500"}`}>
                      {typeCounts[t.id]}
                    </span>
                  </button>
                ))}
              </div>
              <div className="relative ml-auto">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search changes…"
                  className="w-48 rounded-lg bg-zinc-900 py-1.5 pl-8 pr-3 text-[13px] text-zinc-200 ring-1 ring-inset ring-zinc-800 outline-none placeholder:text-zinc-600 focus:ring-zinc-600"
                />
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-zinc-900 p-0.5 ring-1 ring-inset ring-zinc-800">
                {(["all", "You", "CoWork"] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => setFilter(a)}
                    className={`rounded-md px-2.5 py-1 text-[13px] transition ${
                      filter === a ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {actorLabel(a)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-5">
              {groups.map((g) => (
                <section key={g.key}>
                  <h3 className="sticky top-0 z-[1] -mx-1 mb-1 flex items-center gap-2 bg-zinc-950/90 px-1 py-1.5 text-[13px] font-semibold uppercase tracking-wider text-zinc-500 backdrop-blur-sm">
                    {g.label}
                    <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[12px] font-medium text-zinc-400">
                      {g.nodes.reduce((n, node) => n + (node.kind === "event" ? 1 : node.items.length), 0)}
                    </span>
                  </h3>
                  <ol className="relative">
                    {/* timeline rail */}
                    <span aria-hidden className="absolute left-[11px] top-4 bottom-4 w-px bg-zinc-800/70" />
                    {g.nodes.map((node) =>
                      node.kind === "batch" ? (
                        <BatchRow
                          key={node.key}
                          node={node}
                          open={openBatches.has(node.key)}
                          onToggle={() =>
                            setOpenBatches((prev) => {
                              const next = new Set(prev);
                              if (next.has(node.key)) next.delete(node.key);
                              else next.add(node.key);
                              return next;
                            })
                          }
                        />
                      ) : node.kind === "multi" ? (
                        <MultiRow key={node.key} node={node} />
                      ) : (
                        <EventRow key={node.e.id} e={node.e} />
                      )
                    )}
                  </ol>
                </section>
              ))}
              {filtered.length === 0 && (
                <p className="py-8 text-center text-sm text-zinc-600">no events</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
