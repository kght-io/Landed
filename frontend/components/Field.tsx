"use client";

// A labeled text input that commits on blur (and on Enter; Escape reverts). Used by the editable
// config panels on the Discovery page (profile, leveling reference). `accent` tints the focus ring.
export default function Field({
  label,
  value,
  onCommit,
  full,
  placeholder,
  hint,
  accent = "emerald",
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  full?: boolean;
  placeholder?: string;
  hint?: string;
  accent?: "emerald" | "sky";
}) {
  const ring = accent === "sky" ? "focus:ring-sky-500/50" : "focus:ring-emerald-500/50";
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="mb-1.5 block text-[12px] font-medium text-zinc-400">{label}</span>
      <input
        key={value}
        defaultValue={value}
        placeholder={placeholder}
        onBlur={(e) => { if (e.target.value !== value) onCommit(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { e.currentTarget.value = value; e.currentTarget.blur(); }
        }}
        className={`w-full rounded-lg bg-zinc-900/60 px-3 py-2 text-[13px] text-zinc-100 outline-none ring-1 ring-inset ring-zinc-800 transition placeholder:text-zinc-600 hover:ring-zinc-700 focus:ring-2 ${ring}`}
      />
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}
