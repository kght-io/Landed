// Reading an interview loop: what its stages are, which one you're on, and how to say when they
// are. Pure — the drawer renders straight off these, so the phrasing stays directly testable.

import type { InterviewKind, InterviewRound } from "../types";

// Human labels for an interview round's kind. Domain vocabulary for the loop, so it lives with the
// loop model; shared/src/prep/landing.ts re-exports it for the prep landing's "next step" line.
export const ROUND_KIND_LABEL: Record<InterviewKind, string> = {
  recruiter_screen: "Recruiter screen",
  phone_screen: "Phone screen",
  technical: "Technical",
  system_design: "System design",
  behavioral: "Behavioral",
  onsite: "Onsite",
  hiring_manager: "Hiring manager",
  final: "Final",
  other: "Interview",
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "13:00" → "1:00pm". Minutes are dropped only when zero would read worse ("1:00pm" beats "1pm" in a
// time range, so keep them). Returns null for anything that isn't HH:MM.
function clock(hhmm: string): { h: number; m: number } | null {
  const t = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!t) return null;
  const h = Number(t[1]);
  const m = Number(t[2]);
  return h <= 23 && m <= 59 ? { h, m } : null;
}
const ampm = (h: number, m: number) => `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;

// "2026-07-29" → "Wed Jul 29". Built by hand rather than via toLocaleDateString: the viewer's locale
// would otherwise decide whether this reads "Wed, Jul 29" or "29 Jul" — and an interview date is not
// the place for that. An unparseable date is echoed back rather than rendered as "Invalid Date".
function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? date : `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// "Wed Jul 29 · 1:00–2:00pm ET". Degrades honestly: no duration → no end time, no time → just the
// date, no date → "Not scheduled", unparseable date → echoed back rather than "Invalid Date".
export function roundWhen(r: InterviewRound): string {
  if (!r.date) return "Not scheduled";
  const day = dayLabel(r.date);

  const start = r.startTime ? clock(r.startTime) : null;
  if (!start) return day;

  const zone = r.timezone ? ` ${r.timezone}` : "";
  if (!r.durationMins) return `${day} · ${ampm(start.h, start.m)}${zone}`;

  const endMins = start.h * 60 + start.m + r.durationMins;
  const eh = Math.floor(endMins / 60) % 24;
  const em = endMins % 60;
  // Drop the meridiem on the start when both ends share it ("1:00–2:00pm", not "1:00pm–2:00pm").
  const sameHalf = start.h < 12 === eh < 12;
  const startText = sameHalf ? ampm(start.h, start.m).replace(/[ap]m$/, "") : ampm(start.h, start.m);
  return `${day} · ${startText}–${ampm(eh, em)}${zone}`;
}

// ── Stages ─────────────────────────────────────────────────────────────────────────────────────
// A loop is not a flat list of rounds: a recruiter's process is a handful of named STAGES, and one
// stage routinely holds several back-to-back interviews on the same day ("Technical Assessment" =
// API design + system design + a social call). "Round 3 of 7" reads that wrong twice over, so the
// drawer works in stages and shows every round inside the selected one.

export type LoopStage = {
  key: string; // unique within the loop — React key + selection identity
  label: string; // the recruiter's own name for the block, else derived from the rounds
  rounds: InterviewRound[];
  date?: string; // the first dated round's date
  // The rounds' outcomes rolled up, then read against the calendar. A stage whose day has passed
  // with no outcome recorded HAPPENED — you sat it, and you're waiting on the next-step email.
  // That's a different thing from a stage booked for next week, and different again from one
  // they've only named. `unknown` is the placeholder step (no rounds) that closes out a loop stuck
  // in `awaiting`. One field, not an `outcome` beside it: two would have to agree forever.
  state: "passed" | "rejected" | "awaiting" | "upcoming" | "unscheduled" | "unknown";
  totalMins?: number;
  attachments: string[]; // union of the rounds' files, in order, deduped
};

// What ties two rounds together, most trustworthy first: an explicit stage name (the recruiter's
// own), else a shared date (a same-day block), else nothing — an unscheduled round stands alone,
// which is what keeps two announced-but-unbooked future stages from collapsing into one.
const groupKey = (r: InterviewRound, i: number): string => {
  const stage = r.stage?.trim();
  if (stage) return `s:${stage.toLowerCase()}`;
  if (r.date) return `d:${r.date}`;
  return `r:${i}`; // the sorted position — unique by construction, so this round groups with nobody
};

// "150" → "2h30m". Undefined for zero/absent, so callers can drop the segment entirely.
function duration(mins: number | undefined): string | undefined {
  if (!mins) return undefined;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h}h${m}m` : `${h}h`) : `${m}m`;
}

// The loop as a pipeline: its rounds grouped into stages, plus (see the tail of this function) the
// placeholder step when what's next isn't known — i.e. exactly the nodes the drawer's rail renders,
// not a bare grouping. Grouping runs over CONSECUTIVE rounds only, so a stage name that recurs
// later (a second "Onsite") starts a new stage rather than teleporting that round back up into the
// first one. Sorts defensively by round then date — the same order the DB hands back.
export function loopStages(rounds: InterviewRound[], today = new Date().toISOString().slice(0, 10)): LoopStage[] {
  const sorted = [...rounds].sort(
    (a, b) => (a.round ?? 0) - (b.round ?? 0) || (a.date ?? "").localeCompare(b.date ?? ""),
  );
  const runs: { key: string; rounds: InterviewRound[] }[] = [];
  sorted.forEach((r, i) => {
    const key = groupKey(r, i);
    const open = runs[runs.length - 1];
    if (open && open.key === key) open.rounds.push(r);
    else runs.push({ key, rounds: [r] });
  });

  const stages: LoopStage[] = runs.map((run, i) => {
    const rs = run.rounds;
    const outcomes = rs.map((r) => r.outcome ?? "pending");
    const mins = rs.reduce((sum, r) => sum + (r.durationMins ?? 0), 0);
    const files = new Set<string>();
    for (const r of rs) for (const f of r.attachments ?? []) files.add(f);
    const dates = rs.map((r) => r.date).filter((d): d is string => !!d).sort();
    // One rejection ends the loop, so it wins over the rounds that passed before it in the block.
    const outcome = outcomes.includes("rejected") ? "rejected" : outcomes.every((o) => o === "passed") ? "passed" : "pending";
    // A multi-day block isn't behind you until its LAST day is; a day still counts as upcoming
    // until it's over, so the cutoff is strictly-before-today.
    const last = dates.length ? dates[dates.length - 1] : undefined;
    return {
      key: `${run.key}#${i}`, // the run index keeps keys unique when a name recurs
      label: rs[0].stage?.trim() || (rs.length === 1 ? ROUND_KIND_LABEL[rs[0].kind ?? "other"] : "Interview day"),
      rounds: rs,
      date: dates[0],
      state: outcome !== "pending" ? outcome : !last ? "unscheduled" : last < today ? "awaiting" : "upcoming",
      totalMins: mins || undefined,
      attachments: [...files],
    };
  });

  // An interview you've already sat belongs BEHIND where you are, not at the head of the pipeline.
  // When the last thing on the calendar has happened and they've named nothing after it, the loop
  // still has a next step — you just don't know what it is yet. Give it a node so the rail can put
  // the round you sat behind you; it holds no rounds, and that emptiness is the honest answer.
  if (stages[stages.length - 1]?.state === "awaiting") {
    stages.push({ key: "next#unknown", label: "Next step", rounds: [], state: "unknown", attachments: [] });
  }
  return stages;
}

// Which stage the loop is sitting on: what's booked next, else the first stage they've named but
// not scheduled, else the unknown step that follows an interview you've already sat, else the last
// stage reached (a closed posting opens on where it ended). 0 for an empty loop.
export function currentStageIndex(stages: LoopStage[]): number {
  if (!stages.length) return 0;
  const first = (state: LoopStage["state"]) => stages.findIndex((s) => s.state === state);
  for (const state of ["upcoming", "unscheduled", "unknown"] as const) {
    const i = first(state);
    if (i >= 0) return i;
  }
  return stages.length - 1;
}

// "Tue Aug 4 · 3 rounds · 2h30m". A one-round stage reads exactly like its round, plus the length
// when there's no start time to imply it ("Not scheduled · 1h" — an announced round of known size).
export function stageWhen(s: LoopStage): string {
  const dur = duration(s.totalMins);
  if (!s.rounds.length) return "Not scheduled yet"; // the unknown step — nothing to say when
  if (s.rounds.length === 1) {
    const when = roundWhen(s.rounds[0]);
    return !s.rounds[0].startTime && dur ? `${when} · ${dur}` : when;
  }
  const day = s.date ? dayLabel(s.date) : "Not scheduled";
  return `${day} · ${s.rounds.length} rounds${dur ? ` · ${dur}` : ""}`;
}

// Whether a round carries anything beyond its headline (kind + when + outcome) — i.e. whether it's
// worth an expander in the timeline.
export function hasDetail(r: InterviewRound): boolean {
  return !!(
    r.whatToExpect ||
    r.notes ||
    r.format ||
    r.joinUrl ||
    r.interviewers?.length ||
    r.prepNotes?.length
  );
}
