"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

// Thin accent bar per section (header only) — backgrounds stay neutral.
type Accent = "emerald" | "sky" | "violet" | "amber" | "zinc";
const ACCENT_BAR: Record<Accent, string> = {
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  zinc: "bg-zinc-600",
};

// A collapsible page section with a prominent header. Open state persists to localStorage when
// `storageKey` is set. Body padding is owned here (px-6 pb-6) so children don't re-pad.
export default function Section({
  title,
  icon,
  subtitle,
  right,
  accent = "zinc",
  defaultOpen = true,
  storageKey,
  children,
}: {
  title: string;
  icon?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  accent?: Accent;
  defaultOpen?: boolean;
  storageKey?: string;
  children: ReactNode;
}) {
  // Start from defaultOpen so SSR + first client render match (no hydration mismatch); read the
  // persisted state after mount.
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (!storageKey) return;
    try {
      const v = localStorage.getItem(`sec:${storageKey}`);
      // Hydration-safe rehydrate: SSR/first render uses `defaultOpen`, then we restore the persisted
      // open state after mount (avoids a mismatch).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v != null) setOpen(v === "1");
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const toggle = () =>
    setOpen((o) => {
      const n = !o;
      if (storageKey) try { localStorage.setItem(`sec:${storageKey}`, n ? "1" : "0"); } catch { /* ignore */ }
      return n;
    });

  return (
    <section className="border-b border-zinc-800/80">
      <div className={`sticky top-0 z-20 flex items-center gap-3 bg-[var(--background)] px-6 py-4 ${open ? "border-b border-zinc-800/80" : ""}`}>
        <span aria-hidden className={`h-5 w-1 shrink-0 rounded-full ${ACCENT_BAR[accent]}`} />
        <button onClick={toggle} className="group flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronDown size={18} className={`shrink-0 text-zinc-500 transition-transform duration-200 group-hover:text-zinc-300 ${open ? "" : "-rotate-90"}`} />
          {icon}
          <h2 className="shrink-0 text-[15px] font-semibold tracking-tight text-zinc-100">{title}</h2>
          {subtitle != null && <span className="truncate text-[13px] font-normal text-zinc-500">{subtitle}</span>}
        </button>
        {open && right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </div>
      {open && <div className="px-6 pb-6">{children}</div>}
    </section>
  );
}
