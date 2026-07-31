"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import Field from "@/components/Field";
import { EditToggle, PreviewItem, ChipsPreview } from "@/components/settings/EditControls";

type Profile = {
  levelBaseline: string;
  levelRule: string;
  includeDisciplines: string[];
  excludeDisciplines: string[];
  locations: string;
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
          <ChipsPreview label="Exclude disciplines" tone="rose" items={p.excludeDisciplines} />
        </dl>
      )}
      renderEdit={() => (
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <Field label="Level baseline" value={p.levelBaseline} onCommit={(v) => save({ levelBaseline: v })} />
          <Field label="Locations" value={p.locations} onCommit={(v) => save({ locations: v })} />
          <Field label="Target-level rule" value={p.levelRule} onCommit={(v) => save({ levelRule: v })} full />
          <Tags label="Include disciplines" tone="emerald" value={p.includeDisciplines} onCommit={(a) => save({ includeDisciplines: a })} />
          <Tags label="Exclude disciplines" tone="rose" value={p.excludeDisciplines} onCommit={(a) => save({ excludeDisciplines: a })} />
        </div>
      )}
    />
  );
}

// Tag input: type and press Enter (or comma) to add a chip; × or Backspace-on-empty removes.
// Subtly accented panel (emerald = include, rose = exclude) for at-a-glance distinction.
function Tags({ label, value, onCommit, tone, full }: { label: string; value: string[]; onCommit: (a: string[]) => void; tone: "emerald" | "rose"; full?: boolean }) {
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
      <span className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-zinc-400">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
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
