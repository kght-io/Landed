"use client";

import { useState } from "react";
import Link from "next/link";
import { Code2, Network, Building2, Loader2, ChevronRight, CircleCheck, CircleDashed, MessageSquare, CalendarClock } from "lucide-react";
import { STATUS_LABEL } from "@landed/shared/pipeline";
import type { Status } from "@landed/shared/types";
import TabBar from "./TabBar";

// Icon lookup so the server can pass a plain string key across the RSC boundary.
const ICONS = { coding: Code2, "system-design": Network, company: Building2 } as const;
type IconKey = keyof typeof ICONS;

// A generic prep card (tracks + past companies): icon tile, title/sub, and a solved/total progress bar.
export type PrepCardData = {
  href: string;
  iconKey: IconKey;
  title: string;
  sub: string;
  accent: string;
  done: number;
  total: number;
  pct: number;
};

// A company you're actively interviewing with — a company card plus researched status and the
// application's next step (pipeline status + next scheduled round).
export type InterviewingData = {
  slug: string;
  name: string;
  role: string;
  status: Status;
  researched: boolean;
  overview: string | null;
  rounds: number;
  questions: number;
  confirmed: number;
  likely: number;
  done: number;
  pendingFeedback: number;
  nextStepLabel: string | null; // e.g. "System design" — the upcoming round's kind
  nextStepDate: string | null; // ISO date of that round, if known
};

const TABS = [
  { id: "company", label: "Company-specific Prep" },
  { id: "general", label: "General Prep Tracker" },
];

export default function PrepTabs({
  tracks,
  interviewing,
  past,
}: {
  tracks: PrepCardData[];
  interviewing: InterviewingData[];
  past: PrepCardData[];
}) {
  const [tab, setTab] = useState("company");

  return (
    <>
      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {tab === "general" && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {tracks.map((c) => (
            <PrepCard key={c.href} {...c} />
          ))}
        </div>
      )}

      {tab === "company" && (
        <div className="mt-6">
          <SectionHeading>Interviewing now</SectionHeading>
          {interviewing.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {interviewing.map((c) => (
                <InterviewingCard key={c.slug} c={c} />
              ))}
            </div>
          ) : (
            <EmptyNote>No live interview loops right now — companies you enter the interview stage with show up here.</EmptyNote>
          )}

          <SectionHeading className="mt-6">Past interviewed companies</SectionHeading>
          {past.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {past.map((c) => (
                <PrepCard key={c.href} {...c} />
              ))}
            </div>
          ) : (
            <EmptyNote>No past interviews yet — companies whose loop concluded appear here for later reference.</EmptyNote>
          )}
        </div>
      )}
    </>
  );
}

function SectionHeading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`mb-2 text-[13px] font-semibold uppercase tracking-wider text-zinc-600 ${className}`}>{children}</h2>;
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-zinc-800/70 px-4 py-5 text-[13px] text-zinc-600">{children}</p>;
}

// Short "Aug 3" style date for the next-step line.
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

// A company you're interviewing with. Researched → links into its prep page; not yet researched →
// a static card noting the agent is building the prep (the page is force-dynamic, so it fills in on reload).
function InterviewingCard({ c }: { c: InterviewingData }) {
  const nextStep = c.nextStepLabel
    ? c.nextStepDate
      ? `${c.nextStepLabel} · ${shortDate(c.nextStepDate)}`
      : c.nextStepLabel
    : null;
  const inner = (
    <div className={`group rounded-2xl border bg-zinc-900/30 p-5 transition ${c.researched ? "border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/60" : "border-zinc-800/50"}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-400 to-purple-500 text-zinc-950`}>
          <Building2 size={20} strokeWidth={2.4} />
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {/* Researched status */}
          {c.researched ? (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/25">
              <CircleCheck size={10} /> Researched
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-zinc-500/10 px-1.5 py-0.5 text-[11px] font-medium text-zinc-400 ring-1 ring-inset ring-zinc-500/20">
              <Loader2 size={10} className="animate-spin" /> Researching…
            </span>
          )}
          {c.researched && <ChevronRight size={18} className="text-zinc-600 transition group-hover:text-zinc-300" />}
        </div>
      </div>

      <h2 className="truncate text-base font-semibold text-zinc-100" title={c.name}>{c.name}</h2>
      <p className="mt-0.5 truncate text-[13px] text-zinc-500" title={c.role}>{c.role}</p>

      {/* Application status (next step) */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${c.status === "offer" ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/25" : "bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/25"}`}>
          {STATUS_LABEL[c.status]}
        </span>
        {nextStep && (
          <span className="inline-flex items-center gap-1 text-zinc-400">
            <CalendarClock size={12} className="text-zinc-500" /> Next: {nextStep}
          </span>
        )}
        {c.pendingFeedback > 0 && (
          <span className="inline-flex items-center gap-1 rounded bg-violet-500/15 px-1.5 py-0.5 font-medium text-violet-300 ring-1 ring-inset ring-violet-500/25">
            <MessageSquare size={10} /> {c.pendingFeedback} refining
          </span>
        )}
      </div>

      {c.researched ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-zinc-500">
            <span>{c.rounds} round{c.rounds === 1 ? "" : "s"}</span>
            <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {c.confirmed} confirmed</span>
            <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> {c.likely} likely</span>
            <span className="inline-flex items-center gap-1">
              {c.done >= c.questions && c.questions > 0 ? <CircleCheck size={12} className="text-emerald-400" /> : <CircleDashed size={12} />}
              {c.done}/{c.questions} practiced
            </span>
          </div>
        </>
      ) : (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-zinc-500">
          <Loader2 size={13} className="animate-spin text-zinc-600" />
          the agent is researching this company&apos;s interview process…
        </div>
      )}
    </div>
  );
  return c.researched ? <Link href={`/prep/company/${c.slug}`}>{inner}</Link> : inner;
}

function PrepCard({ href, iconKey, title, sub, accent, done, total, pct }: PrepCardData) {
  const Icon = ICONS[iconKey];
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-5 transition hover:border-zinc-700 hover:bg-zinc-900/60"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${accent} text-zinc-950`}>
          <Icon size={20} strokeWidth={2.4} />
        </div>
        <span className="font-mono text-[13px] text-zinc-500">
          {done}/{total}
        </span>
      </div>
      <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
      <p className="mt-0.5 text-[13px] text-zinc-500">{sub}</p>
      <div className="mt-4 h-1.5 overflow-hidden rounded bg-zinc-800">
        <div className={`h-full rounded bg-gradient-to-r ${accent} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </Link>
  );
}
