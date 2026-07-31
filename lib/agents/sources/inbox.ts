import type { EmailRefs, InterviewKind, Interviewer, InterviewRound, Status } from "@/lib/types";
import { str } from "@/lib/coerce";
import type { IncomingApp } from "../types";

// inbox-sync statuses -> our pipeline enum. (No 'offer' status yet → treat as in-process.)
const STATUS_MAP: Record<string, Status> = {
  rejected: "rejected",
  no_response: "ghost",
  applied: "applied",
  interviewing: "interview",
  offer: "interview",
  expired: "expired",
};

// Coarse round types the agent may emit, mapped onto our enum; anything unrecognized → "other".
const KIND_MAP: Record<string, InterviewKind> = {
  recruiter_screen: "recruiter_screen", recruiter: "recruiter_screen", recruiter_call: "recruiter_screen", screen: "recruiter_screen",
  phone_screen: "phone_screen", phone: "phone_screen",
  technical: "technical", coding: "technical", tech: "technical",
  system_design: "system_design", design: "system_design",
  behavioral: "behavioral", values: "behavioral",
  onsite: "onsite", loop: "onsite",
  hiring_manager: "hiring_manager", hm: "hiring_manager", manager: "hiring_manager",
  final: "final",
};
const toKind = (v: unknown): InterviewKind | undefined => {
  const k = str(v)?.toLowerCase().replace(/[\s-]+/g, "_");
  return k ? KIND_MAP[k] ?? "other" : undefined;
};
const toOutcome = (v: unknown): InterviewRound["outcome"] | undefined => {
  const o = str(v)?.toLowerCase();
  return o === "passed" || o === "rejected" || o === "pending" ? o : undefined;
};

// "1:00pm" / "13:00" / "1pm" → "13:00". Anything else → undefined, so a time we can't read is
// simply absent rather than silently wrong on the drawer's Up-next card.
function toStartTime(v: unknown): string | undefined {
  const s = str(v)?.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return undefined;
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(s);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// Loose JSON → a list of trimmed strings (their how-to-prepare bullets). A single string is
// accepted as a one-item list; empties drop out.
function toStrList(v: unknown): string[] | undefined {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const out = arr.map((x) => str(x)).filter((x): x is string => !!x);
  return out.length ? out : undefined;
}

// Loose JSON → interviewers. Accepts [{name,title}] or bare strings ("Zain Lakhani — Chief AI
// Officer"), splitting the common "name — title" / "name (title)" shapes.
function toInterviewers(v: unknown): Interviewer[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((x): Interviewer | null => {
      if (typeof x === "string") {
        const s = x.trim();
        if (!s) return null;
        const m = /^(.+?)\s*(?:[—–-]|\()\s*(.+?)\)?$/.exec(s);
        return m ? { name: m[1].trim(), title: m[2].trim() } : { name: s };
      }
      const o = (x ?? {}) as Record<string, unknown>;
      const name = str(o.name) ?? str(o.who);
      return name ? { name, title: str(o.title) ?? str(o.role) } : null;
    })
    .filter((x): x is Interviewer => !!x);
  return out.length ? out : undefined;
}

// Map a record's `interviews` array (loose JSON from the agent) → normalized InterviewRound[].
// Shared by both writers: inbox-sync fills the thin fields (kind/date/outcome), interview-emails
// adds the round's substance (who, exact time, format, what to expect, how to prep). Fields the
// caller didn't report stay undefined so upsertInterviews preserves whatever is stored.
export function incomingRounds(raw: unknown): InterviewRound[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rounds = raw
    .map((r, i): InterviewRound => {
      const o = (r ?? {}) as Record<string, unknown>;
      const n = Number(o.round);
      const mins = Number(o.durationMins ?? o.duration ?? o.lengthMins);
      return {
        round: Number.isFinite(n) && n > 0 ? n : i + 1,
        kind: toKind(o.kind ?? o.type),
        date: str(o.date) ?? str(o.scheduledFor),
        outcome: toOutcome(o.outcome ?? o.status),
        notes: str(o.notes) ?? str(o.note),
        emailId: str(o.emailId) ?? str(o.threadId) ?? str(o.gmailThreadId),
        startTime: toStartTime(o.startTime ?? o.time ?? o.startsAt),
        durationMins: Number.isFinite(mins) && mins > 0 ? mins : undefined,
        timezone: str(o.timezone) ?? str(o.tz),
        interviewers: toInterviewers(o.interviewers ?? o.who ?? o.people),
        format: str(o.format),
        joinUrl: str(o.joinUrl) ?? str(o.zoomUrl) ?? str(o.meetingUrl),
        whatToExpect: str(o.whatToExpect) ?? str(o.expect) ?? str(o.description),
        prepNotes: toStrList(o.prepNotes ?? o.howToPrepare ?? o.prep),
      };
    })
    // Drop fully-empty entries — but a round is real if it carries ANY of the new detail too.
    .filter((r) => r.kind || r.date || r.notes || r.emailId || r.whatToExpect || r.interviewers?.length || r.joinUrl || r.format || r.prepNotes?.length);
  return rounds.length ? rounds : undefined;
}

// Pull per-stage Gmail thread ids from a record (best-effort): an `emailRefs` map, else flat keys
// The agent may emit. Empty → undefined, so it never overwrites stored ids with nothing.
function incomingEmailRefs(r: Record<string, unknown>): EmailRefs | undefined {
  const m = (r.emailRefs ?? r.emails) as Record<string, unknown> | undefined;
  const out: EmailRefs = {};
  const put = (k: keyof EmailRefs, v: unknown) => { const s = str(v); if (s) out[k] = s; };
  if (m && typeof m === "object") {
    put("applied", m.applied); put("rejected", m.rejected); put("offer", m.offer); put("interview", m.interview);
  }
  put("applied", r.confirmationEmailId ?? r.appliedEmailId);
  put("rejected", r.rejectionEmailId);
  put("offer", r.offerEmailId);
  return Object.keys(out).length ? out : undefined;
}

// Map inbox-sync result records (the JSON `results[]`) → normalized IncomingApp for reconcile.
export function incomingFromInboxRecords(records: Record<string, unknown>[]): IncomingApp[] {
  return records.map((r): IncomingApp => {
    const note = str(r.note) ?? "";
    return {
      company: str(r.company) ?? "",
      role: str(r.role),
      level: str(r.level),
      team: str(r.team),
      location: str(r.location),
      status: STATUS_MAP[String(r.status ?? "")] ?? "applied",
      interviewed: r.interviewed === true || r.interviewed === "yes",
      appliedDate: str(r.appliedDate),
      updatedAt: str(r.lastUpdate) ?? str(r.appliedDate),
      channel: r.channel === "referral" ? "referral" : r.channel === "direct" ? "direct" : undefined,
      source: str(r.source),
      url: str(r.url),
      note: note || undefined,
      needsReview: /unclear if application submitted/i.test(note),
      interviews: incomingRounds(r.interviews ?? r.rounds),
      emailRefs: incomingEmailRefs(r),
    };
  });
}
