"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, X, ArrowRight, Rocket, FilePlus2 } from "lucide-react";
import { useAddJob } from "@/components/AddJobProvider";
import { onboardingAllDone, OPEN_GETSTARTED_EVENT, type OnboardingStatus } from "@landed/shared/onboarding-shared";

const DISMISS_KEY = "landed.getstarted.dismissed";

type Step = { key: keyof OnboardingStatus; label: string; href?: string; action?: "add"; optional?: boolean };
const STEPS: Step[] = [
  { key: "profile", label: "Set your search profile", href: "/profile" },
  { key: "assetFolder", label: "Set up your asset folder", href: "/settings" },
  { key: "resume", label: "Upload your base résumé", href: "/profile" },
  { key: "firstJob", label: "Add your first job — paste a JD", action: "add" },
  { key: "gmail", label: "Connect Gmail", href: "/settings", optional: true },
  { key: "agent", label: "Run the agent", href: "/agents", optional: true },
];

// The first-run "Get started" card. Each step reflects real state (see /api/onboarding), so it ticks
// off as you actually set the app up. Shown on every page (mounted in the layout) until all steps are
// done or you dismiss it; the empty-table "Get started" button re-opens it. Fixed bottom-left so it
// clears the floating queue.
export default function GetStartedChecklist() {
  const { openAddJob } = useAddJob();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [dismissed, setDismissed] = useState(true); // start hidden → no flash before we know

  const load = useCallback(() => {
    fetch("/api/onboarding").then((r) => r.json()).then((d) => setStatus(d.status ?? null)).catch(() => {});
  }, []);

  useEffect(() => {
    // Rehydrate the dismissed flag after mount (starts hidden for a clean SSR/first render, so there's
    // no flash before we know) — a one-shot init, not a render loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === "1"); } catch { setDismissed(false); }
    load();
    // Re-check when a job is added here, or when returning to the tab after setting things up elsewhere.
    const onChange = () => load();
    // The empty-table button asks to re-open the card — un-dismiss (progress is always live) + refresh.
    const onOpen = () => { try { localStorage.removeItem(DISMISS_KEY); } catch { /* quota */ } setDismissed(false); load(); };
    window.addEventListener("landed:job-added", onChange);
    window.addEventListener("focus", onChange);
    window.addEventListener(OPEN_GETSTARTED_EVENT, onOpen);
    return () => {
      window.removeEventListener("landed:job-added", onChange);
      window.removeEventListener("focus", onChange);
      window.removeEventListener(OPEN_GETSTARTED_EVENT, onOpen);
    };
  }, [load]);

  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* quota */ } setDismissed(true); };

  if (dismissed || !status || onboardingAllDone(status)) return null;

  const doneCount = STEPS.filter((s) => status[s.key]).length;

  return (
    <div className="fixed bottom-6 left-6 z-40 w-80 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/95 shadow-2xl shadow-black/50 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-sky-500 text-zinc-950">
          <Rocket size={15} strokeWidth={2.5} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-zinc-100">Get started</p>
          <p className="text-[11px] text-zinc-500">{doneCount} of {STEPS.length} done</p>
        </div>
        <button onClick={dismiss} title="Dismiss" className="shrink-0 rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"><X size={15} /></button>
      </div>

      <ul className="p-1.5">
        {STEPS.map((s) => {
          const done = status[s.key];
          const inner = (
            <>
              {done
                ? <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
                : <Circle size={16} className="shrink-0 text-zinc-600" />}
              <span className={`min-w-0 flex-1 truncate text-[13px] ${done ? "text-zinc-500 line-through" : "text-zinc-200"}`}>
                {s.label}
                {s.optional && <span className="ml-1 text-[11px] text-zinc-600">(optional)</span>}
              </span>
              {!done && (s.action === "add"
                ? <FilePlus2 size={13} className="shrink-0 text-emerald-300" />
                : <ArrowRight size={13} className="shrink-0 text-zinc-500" />)}
            </>
          );
          const cls = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-zinc-900";
          if (done) return <li key={s.key}><div className={`${cls} cursor-default`}>{inner}</div></li>;
          return (
            <li key={s.key}>
              {s.action === "add"
                ? <button onClick={openAddJob} className={cls}>{inner}</button>
                : <Link href={s.href!} className={cls}>{inner}</Link>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
