"use client";

export type Tab = { id: string; label: string };

// Underline tab bar matching the app's dark cockpit chrome.
export default function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-zinc-800/80 [scrollbar-width:none]">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[14px] font-medium transition ${
              on
                ? "border-emerald-400 text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
