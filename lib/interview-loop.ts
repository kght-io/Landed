// Reading an interview loop: which round is up next, and how to say when it is. Pure — the drawer's
// "Up next" card and the timeline both render off these, and the phrasing stays directly testable.

import type { InterviewRound } from "@/lib/types";

// A round is outstanding until it has an outcome that isn't `pending`. "Up next" is the earliest
// outstanding round by round number — not array position, and not "the last one", so a loop where
// round 2 was rejected but round 3 is still booked still points at round 3.
export function nextRound(rounds: InterviewRound[]): InterviewRound | null {
  const pending = rounds.filter((r) => (r.outcome ?? "pending") === "pending");
  if (!pending.length) return null;
  return pending.reduce((best, r) => ((r.round ?? 0) < (best.round ?? 0) ? r : best));
}

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

// "Wed Jul 29 · 1:00–2:00pm ET". Degrades honestly: no duration → no end time, no time → just the
// date, no date → "Not scheduled", unparseable date → echoed back rather than "Invalid Date".
export function roundWhen(r: InterviewRound): string {
  if (!r.date) return "Not scheduled";
  const d = new Date(`${r.date}T00:00:00`);
  // Built by hand rather than via toLocaleDateString: the viewer's locale would otherwise decide
  // whether this reads "Wed, Jul 29" or "29 Jul" — and an interview date is not the place for that.
  const day = Number.isNaN(d.getTime())
    ? r.date
    : `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;

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
