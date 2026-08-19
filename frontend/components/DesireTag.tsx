"use client";

import { coerceDesire, desireLabel, DESIRE_META, DESIRE_VALUES } from "@landed/shared/config/desire";

// The "how much do I want this company" tag (1–5), as an editable chip. Yours to set — the agent
// never writes it and no pipeline rule reads it, so this is the only place it comes from.
// The chip IS the control: a native <select> laid over it keeps the keyboard/mobile behavior
// without a custom menu, matching how TierSelect stays a plain select.
export function DesireSelect({
  desire,
  onDesire,
  className = "",
}: {
  desire: number | null | undefined;
  onDesire: (d: number | null) => void;
  className?: string;
}) {
  const d = coerceDesire(desire);
  const meta = d == null ? null : DESIRE_META[d];
  return (
    <span
      className={`relative inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] ring-1 ring-inset transition ${
        meta ? `${meta.chip} ${meta.text}` : "bg-transparent text-zinc-600 ring-zinc-800 hover:text-zinc-400"
      } ${className}`}
      title={meta ? `Want: ${desireLabel(d)} — ${meta.hint}` : "How much you want this company (1–5)"}
    >
      <span className="font-medium tabular-nums">{d ?? "–"}</span>
      <span className="truncate">{meta?.label ?? "untagged"}</span>
      <select
        value={d ?? ""}
        onChange={(e) => onDesire(e.target.value === "" ? null : Number(e.target.value))}
        aria-label="How much you want this company"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="" className="bg-zinc-900 text-zinc-200">— untagged</option>
        {DESIRE_VALUES.map((v) => (
          <option key={v} value={v} className="bg-zinc-900 text-zinc-200">
            {desireLabel(v)}
          </option>
        ))}
      </select>
    </span>
  );
}
