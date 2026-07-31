"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Briefcase, History, Bot, GraduationCap, FlaskConical, LayoutDashboard, Settings, UserCircle, Plus, Radar } from "lucide-react";
import { useAddJob } from "@/components/AddJobProvider";

// The rail is grouped into clusters (rendered with a divider between each); each item's optional
// `badge` carries its color and the live count is looked up by href from the `counts` map below.
// Workspace (the job-search surfaces) · Agents (MCP lives inside the Agents page) · Activity · You.
const GROUPS = [
  [
    { href: "/", label: "Home", icon: Home },
    { href: "/watchlist", label: "Watchlist", icon: Radar },
    { href: "/prep", label: "Prep", icon: GraduationCap },
    { href: "/fit-lab", label: "Fit Lab", icon: FlaskConical },
  ],
  [{ href: "/agents", label: "Agents", icon: Bot }],
  [
    { href: "/dashboard", label: "Stats", icon: LayoutDashboard },
    { href: "/changes", label: "Changes", icon: History, badge: "bg-amber-500 text-amber-950" },
  ],
  [
    { href: "/profile", label: "Profile", icon: UserCircle },
    { href: "/settings", label: "Settings", icon: Settings },
  ],
];

type NavItem = { href: string; label: string; icon: typeof Home; badge?: string };
const ALL_ITEMS: NavItem[] = GROUPS.flat();

export default function NavRail() {
  const pathname = usePathname();
  const { openAddJob } = useAddJob();
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Last path visited within each section (keyed by base href) — so clicking a nav item returns you
  // to exactly where you were (e.g. the company you were viewing), not the section's landing.
  const [remembered, setRemembered] = useState<Record<string, string>>({});

  useEffect(() => {
    // refresh counts when navigating (e.g. after resolving a flag). The badge = everything awaiting
    // your action: posting reviews + pending matches (fuzzy/ambiguous + unbound fit/tailor results).
    fetch("/api/events")
      .then((r) => r.json())
      .catch(() => ({}))
      .then((events) =>
        setCounts({ "/changes": (events.needsReview?.length ?? 0) + (events.pendingMatches?.length ?? 0) }));
  }, [pathname]);

  useEffect(() => {
    // Rehydrate remembered paths, then record the current path under its section. Starts empty so the
    // first (server-matched) render uses base hrefs — no hydration mismatch — then updates on mount.
    const next: Record<string, string> = {};
    for (const it of ALL_ITEMS) {
      if (it.href === "/") continue;
      try { const v = localStorage.getItem(`landed.nav.${it.href}`); if (v) next[it.href] = v; } catch { /* ignore */ }
    }
    const section = ALL_ITEMS.find((it) => it.href !== "/" && pathname.startsWith(it.href))?.href;
    if (section) {
      try { localStorage.setItem(`landed.nav.${section}`, pathname); } catch { /* quota */ }
      next[section] = pathname;
    }
    // Hydration-safe rehydrate: SSR/first render starts empty (base hrefs), then we restore remembered
    // paths after mount (avoids a mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRemembered(next);
  }, [pathname]);

  const renderItem = ({ href, label, icon: Icon, badge }: NavItem) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    const count = counts[href] ?? 0;
    const target = href === "/" ? "/" : remembered[href] ?? href; // return to last view in this section
    return (
      <Link
        key={href}
        href={target}
        title={label}
        className={`group relative flex h-11 w-11 flex-col items-center justify-center rounded-xl transition ${
          active ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
        }`}
      >
        {active && <span className="absolute -left-[14px] h-5 w-[3px] rounded-full bg-emerald-400" />}
        {badge && count > 0 && (
          <span className={`absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[11px] font-bold ${badge}`}>
            {count}
          </span>
        )}
        <Icon size={19} />
        <span className="mt-0.5 text-[11px] font-medium">{label}</span>
      </Link>
    );
  };

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-zinc-800/80 bg-zinc-950 py-4">
      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-sky-500 text-zinc-950 shadow-lg shadow-emerald-500/20">
        <Briefcase size={18} strokeWidth={2.5} />
      </div>
      {/* Primary action: pasting a JD is the main way jobs enter Landed, so it's the top, always-on
          affordance — reachable from any page, not just the pipeline. */}
      <button
        onClick={openAddJob}
        title="Add a job by pasting its description"
        className="group relative mb-1 flex h-11 w-11 flex-col items-center justify-center rounded-xl bg-emerald-500/90 text-emerald-950 transition hover:bg-emerald-400"
      >
        <Plus size={19} strokeWidth={2.5} />
        <span className="mt-0.5 text-[11px] font-medium">Add</span>
      </button>
      <div aria-hidden className="my-1.5 h-px w-7 rounded-full bg-zinc-800/80" />
      {GROUPS.map((group, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <div aria-hidden className="my-1.5 h-px w-7 rounded-full bg-zinc-800/80" />}
          {group.map(renderItem)}
        </Fragment>
      ))}
    </nav>
  );
}
