// Shared Tailwind primitives for the prep views (dark cockpit theme).

// Difficulty / frequency badge color. Covers LeetCode (Easy/Medium/Hard) + SD (freq).
export function diffCls(d?: string): string {
  switch ((d ?? "").toLowerCase()) {
    case "easy":
      return "text-emerald-300 bg-emerald-500/10 ring-emerald-500/25";
    case "medium":
      return "text-amber-300 bg-amber-500/10 ring-amber-500/25";
    case "hard":
      return "text-rose-300 bg-rose-500/10 ring-rose-500/25";
    default:
      return "text-zinc-400 bg-zinc-800/60 ring-zinc-700/50";
  }
}

// Best-time color: under 20m green, under 35m amber, else rose (mirrors the artifact).
export function timeCls(sec?: number): string {
  if (sec == null) return "text-zinc-500";
  const min = sec / 60;
  if (min <= 20) return "text-emerald-300";
  if (min <= 35) return "text-amber-300";
  return "text-rose-300";
}

export function fmtTime(sec?: number): string {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : m === 0 ? `${s}s` : `${m}m${s}s`;
}

// Signal-level badge color (e.g. "CRITICAL", "TABLE STAKES", "SENIOR+").
export function levelCls(level?: string): string {
  const l = (level ?? "").toLowerCase();
  if (l.includes("critical")) return "text-rose-300 bg-rose-500/10 ring-rose-500/25";
  if (l.includes("table")) return "text-amber-300 bg-amber-500/10 ring-amber-500/25";
  if (l.includes("senior")) return "text-sky-300 bg-sky-500/10 ring-sky-500/25";
  if (l.includes("staff")) return "text-rose-300 bg-rose-500/10 ring-rose-500/25";
  return "text-fuchsia-300 bg-fuchsia-500/10 ring-fuchsia-500/25";
}

// Code block (templates) — monospace, scrollable, dark.
export function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[13px] leading-relaxed text-zinc-300">
      <code>{children}</code>
    </pre>
  );
}

export function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium ring-1 ring-inset ${className}`}
    >
      {children}
    </span>
  );
}

export function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-semibold tracking-tight text-zinc-100">{title}</h2>
      {sub && <p className="mt-1 text-sm text-zinc-500">{sub}</p>}
    </div>
  );
}
