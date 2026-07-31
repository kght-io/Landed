"use client";

import { useState, type ReactNode } from "react";
import { Pencil, Check } from "lucide-react";

// Shared view/edit affordances for the settings panels: an Edit toggle, a Save (confirm) toggle,
// and read-only preview cells. Values persist on field blur; Save just returns to the preview.

// The view/edit scaffold every editable settings panel shares: a right-aligned Edit/Save control
// over either the read-only preview or the input fields. Values persist on blur, so Save just
// returns to the preview.
export function EditToggle({ renderPreview, renderEdit }: { renderPreview: () => ReactNode; renderEdit: () => ReactNode }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {editing ? <SaveButton onClick={() => setEditing(false)} /> : <EditButton onClick={() => setEditing(true)} />}
      </div>
      {editing ? renderEdit() : renderPreview()}
    </div>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-2.5 py-1 text-[12px] font-medium text-zinc-300 ring-1 ring-inset ring-zinc-700 transition hover:bg-zinc-700"
    >
      <Pencil size={12} /> Edit
    </button>
  );
}

function SaveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1 text-[12px] font-medium text-emerald-950 transition hover:bg-emerald-400"
    >
      <Check size={12} /> Save
    </button>
  );
}

type Tone = "emerald" | "sky" | "rose";
const TONE: Record<Tone, { label: string; dot: string; ring: string; chip: string }> = {
  emerald: { label: "text-emerald-300/90", dot: "bg-emerald-400", ring: "ring-emerald-500/20", chip: "bg-emerald-500/15 text-emerald-300" },
  sky: { label: "text-sky-300/90", dot: "bg-sky-400", ring: "ring-sky-500/20", chip: "bg-sky-500/15 text-sky-300" },
  rose: { label: "text-rose-300/90", dot: "bg-rose-400", ring: "ring-rose-500/20", chip: "bg-rose-500/15 text-rose-300" },
};

export function PreviewItem({ label, value, accent = "emerald", full }: { label: string; value?: string; accent?: Tone; full?: boolean }) {
  const t = TONE[accent];
  const set = !!value?.trim();
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className={`mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide ${t.label}`}>
        <span className={`h-1 w-1 rounded-full ${t.dot}`} /> {label}
      </dt>
      {/* Read-only: plain text (no box/ring) so it doesn't look like an editable input until Edit is hit. */}
      <dd className={`px-0.5 text-[13px] leading-relaxed ${set ? "text-zinc-100" : "italic text-zinc-600"}`}>
        {set ? value : "Not set"}
      </dd>
    </div>
  );
}

export function ChipsPreview({ label, items, tone, full }: { label: string; items: string[]; tone: "emerald" | "rose"; full?: boolean }) {
  const t = TONE[tone];
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className={`mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide ${t.label}`}>
        <span className={`h-1 w-1 rounded-full ${t.dot}`} /> {label}
      </dt>
      {/* Read-only: bare chips (no surrounding input-like box). */}
      <dd className="flex flex-wrap gap-1 px-0.5 pt-0.5">
        {items.length ? (
          items.map((x) => <span key={x} className={`rounded px-1.5 py-0.5 text-[12px] font-medium ${t.chip}`}>{x}</span>)
        ) : (
          <span className="text-[13px] italic text-zinc-600">Not set</span>
        )}
      </dd>
    </div>
  );
}
