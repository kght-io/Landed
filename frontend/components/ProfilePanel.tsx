"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import Field from "@/components/Field";
import { EditToggle, PreviewItem, ChipsPreview } from "@/components/settings/EditControls";

type Profile = {
  levelBaseline: string;
  levelRule: string;
  includeDisciplines: string[];
  // One list per discard axis, not one `excludeDisciplines` bag. The axes mirror the discard reasons
  // exactly (@landed/shared/jobs/dismiss) so a "stack mismatch" discard has somewhere to land — and so
  // the exclusion says which KIND of rejection it is, which one merged list couldn't.
  excludeRoles: string[];
  excludeStacks: string[];
  excludeDomains: string[];
  locations: string;
  // Stage 1 — matched mechanically at scan and DROP, unlike the three axes above (guidance the agent
  // weighs). Kept visually apart for that reason.
  excludeTitleTerms: string[];
  excludeLocationTerms: string[];
  allowLocationTerms: string[];
};

// Editable search identity — the source of truth for what counts as a fit. Read by the agents' scan
// pass and fit leveling (via getContext). Chrome-less: the settings page owns the card.
export default function ProfilePanel() {
  const [p, setP] = useState<Profile | null>(null);

  useEffect(() => {
    fetch("/api/profile").then((r) => r.json()).then((d) => setP(d.profile)).catch(() => {});
  }, []);
  if (!p) return <p className="text-[13px] text-zinc-500">Loading…</p>;

  // Optimistic merge + persist just the changed field (on blur). Save just returns to the preview.
  const save = (patch: Partial<Profile>) => {
    pendo.track("profile_updated", {
      changed_fields: Object.keys(patch).join(","),
    });
    setP({ ...p, ...patch });
    fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).catch(() => {});
  };

  return (
    <EditToggle
      renderPreview={() => (
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <PreviewItem label="Level baseline" value={p.levelBaseline} />
          <PreviewItem label="Locations" value={p.locations} />
          <PreviewItem label="Target-level rule" value={p.levelRule} full />
          <ChipsPreview label="Include disciplines" tone="emerald" items={p.includeDisciplines} />
          <ChipsPreview label="Exclude roles" tone="rose" items={p.excludeRoles} />
          <ChipsPreview label="Exclude stacks" tone="rose" items={p.excludeStacks} />
          <ChipsPreview label="Exclude domains" tone="rose" items={p.excludeDomains} />
          <ChipsPreview label="Scan drops — title terms" tone="rose" items={p.excludeTitleTerms} />
          <ChipsPreview label="Scan drops — locations" tone="rose" items={p.excludeLocationTerms} />
          <ChipsPreview label="Scan keeps anyway — locations" tone="emerald" items={p.allowLocationTerms} />
        </dl>
      )}
      renderEdit={() => (
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Field label="Level baseline" value={p.levelBaseline} onCommit={(v) => save({ levelBaseline: v })} />
          <Field label="Locations" value={p.locations} onCommit={(v) => save({ locations: v })} />
          <Field label="Target-level rule" value={p.levelRule} onCommit={(v) => save({ levelRule: v })} full />
          <Tags label="Include disciplines" tone="emerald" value={p.includeDisciplines} onCommit={(a) => save({ includeDisciplines: a })} />
          {/* Three exclude axes, each hinting at what belongs on it. Without the hints the split is a
              filing question the user has to re-answer every time, and terms end up on whichever axis
              they happened to open. */}
          <Tags label="Exclude roles" hint="a different job — SRE, ML/research, data eng, IT" tone="rose" value={p.excludeRoles} onCommit={(a) => save({ excludeRoles: a })} />
          <Tags label="Exclude stacks" hint="same job, wrong technology — iOS, frontend, C++" tone="rose" value={p.excludeStacks} onCommit={(a) => save({ excludeStacks: a })} />
          <Tags label="Exclude domains" hint="same job and stack, dull problem — ads, crypto" tone="rose" value={p.excludeDomains} onCommit={(a) => save({ excludeDomains: a })} />
          {/* Stage 1. These DROP at scan, before any agent sees the posting — the axes above only steer
              the agent. Full width because the lists are long, and the hint states the grammar, since a
              term typed here is matched literally rather than read. */}
          <Tags full label="Scan drops — title terms" hint="whole words · hyphen = space · trailing * = stem (recruit*)" tone="rose" value={p.excludeTitleTerms} onCommit={(a) => save({ excludeTitleTerms: a })} />
          <Tags full label="Scan drops — locations" hint="out of range even when a posting says remote" tone="rose" value={p.excludeLocationTerms} onCommit={(a) => save({ excludeLocationTerms: a })} />
          <Tags full label="Scan keeps anyway — locations" hint="re-admits a posting that also names a dropped locale (US/Canada)" tone="emerald" value={p.allowLocationTerms} onCommit={(a) => save({ allowLocationTerms: a })} />
        </div>
      )}
    />
  );
}

// Tag input: type and press Enter (or comma) to add a chip; × or Backspace-on-empty removes.
// Subtly accented panel (emerald = include, rose = exclude) for at-a-glance distinction.
function Tags({ label, hint, value, onCommit, tone, full }: { label: string; hint?: string; value: string[]; onCommit: (a: string[]) => void; tone: "emerald" | "rose"; full?: boolean }) {
  const [draft, setDraft] = useState("");
  const dot = tone === "emerald" ? "bg-emerald-400" : "bg-rose-400";
  const chip = tone === "emerald" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300";

  const add = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const next = [...value];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    if (next.length !== value.length) onCommit(next);
    setDraft("");
  };
  const remove = (t: string) => onCommit(value.filter((x) => x !== t));

  return (
    <div className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px] font-medium text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {label}
        </span>
        {hint && <span className="font-normal text-zinc-600">{hint}</span>}
      </span>
      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-zinc-900/60 p-2 ring-1 ring-inset ring-zinc-800 transition focus-within:ring-2 focus-within:ring-zinc-600">
        {value.map((t) => (
          <span key={t} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium ${chip}`}>
            {t}
            <button type="button" onClick={() => remove(t)} className="opacity-60 transition hover:opacity-100" aria-label={`Remove ${t}`}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={value.length ? "add…" : "type and press Enter…"}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(draft); }
            else if (e.key === "Backspace" && !draft && value.length) { e.preventDefault(); remove(value[value.length - 1]); }
          }}
          onBlur={() => add(draft)}
          className="min-w-[90px] flex-1 bg-transparent px-1 py-0.5 text-[13px] text-zinc-200 outline-none placeholder:text-zinc-600"
        />
      </div>
    </div>
  );
}
