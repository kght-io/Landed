import type { ReactNode } from "react";

// A clean, non-collapsible settings card: icon + title + description header, divider, body.
// Matches GmailConnect's card aesthetic so every section on the page reads as one system.
type Accent = "emerald" | "sky" | "violet" | "zinc";
const ICON: Record<Accent, string> = {
  emerald: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20",
  sky: "bg-sky-500/10 text-sky-300 ring-sky-500/20",
  violet: "bg-violet-500/10 text-violet-300 ring-violet-500/20",
  zinc: "bg-zinc-800 text-zinc-300 ring-zinc-700",
};

export default function SettingsCard({
  icon,
  title,
  description,
  right,
  accent = "zinc",
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  right?: ReactNode;
  accent?: Accent;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/30">
      <div className="flex items-start gap-3 px-5 py-4">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${ICON[accent]}`}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight text-zinc-100">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-500">{description}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      <div className="border-t border-zinc-800/70 px-5 py-4">{children}</div>
    </section>
  );
}
