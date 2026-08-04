import type { EmailRefs, InterviewKind, Interviewer, InterviewRound, Status } from "../../types";
import { str, warningLog } from "../../util/coerce";
import type { CoerceWarning, WarningLog } from "../../util/coerce";
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
// An ABSENT kind is normal (the caller left it out) → undefined, no warning. A kind that was given
// but doesn't match falls back to "other" AND is reported: that's a value we misread, not one we
// weren't told.
const toKind = (v: unknown, log?: WarningLog, subject?: string): InterviewKind | undefined => {
  const raw = str(v);
  if (!raw) return undefined;
  const k = raw.toLowerCase().replace(/[\s-]+/g, "_");
  return log ? log.pick(KIND_MAP, k, "other", { subject, field: "kind", value: raw }) : KIND_MAP[k] ?? "other";
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
export function incomingRounds(raw: unknown, log?: WarningLog, subject?: string): InterviewRound[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rounds = raw
    .map((r, i): InterviewRound => {
      const o = (r ?? {}) as Record<string, unknown>;
      const n = Number(o.round);
      const mins = Number(o.durationMins ?? o.duration ?? o.lengthMins);
      return {
        round: Number.isFinite(n) && n > 0 ? n : i + 1,
        stage: str(o.stage) ?? str(o.stageName) ?? str(o.group),
        kind: toKind(o.kind ?? o.type, log, subject),
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
        attachments: toStrList(o.attachments ?? o.files),
      };
    })
    // Drop fully-empty entries — but a round is real if it carries ANY of the new detail too.
    .filter((r) => r.stage || r.kind || r.date || r.notes || r.emailId || r.whatToExpect || r.interviewers?.length || r.joinUrl || r.format || r.prepNotes?.length || r.attachments?.length);
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
//
// Returns the warnings alongside the records: the coercion below is forgiving on purpose, but every
// substitution it makes is something the run should be able to report rather than absorb. Reconcile
// counts a THIRD failure mode itself (a company it can't canonicalize, which never reaches a group).
export function incomingFromInboxRecords(
  records: Record<string, unknown>[],
): { records: IncomingApp[]; warnings: CoerceWarning[] } {
  const log = warningLog();
  const mapped = records.map((r): IncomingApp => {
    const note = str(r.note) ?? "";
    const company = str(r.company) ?? "";
    const subject = [company || "(no company)", str(r.role)].filter(Boolean).join(" — ");
    const rawStatus = str(r.status);
    return {
      company,
      role: str(r.role),
      level: str(r.level),
      team: str(r.team),
      location: str(r.location),
      // No status at all is normal (the agent omitted it) → the plain default, silently. A status it
      // DID send that we don't recognize is a misread, and gets reported.
      status: rawStatus ? log.pick(STATUS_MAP, rawStatus, "applied", { subject, field: "status", value: rawStatus }) : "applied",
      interviewed: r.interviewed === true || r.interviewed === "yes",
      appliedDate: str(r.appliedDate),
      updatedAt: str(r.lastUpdate) ?? str(r.appliedDate),
      channel: r.channel === "referral" ? "referral" : r.channel === "direct" ? "direct" : undefined,
      source: str(r.source),
      url: str(r.url),
      note: note || undefined,
      needsReview: /unclear if application submitted/i.test(note),
      interviews: incomingRounds(r.interviews ?? r.rounds, log, subject),
      emailRefs: incomingEmailRefs(r),
    };
  });
  return { records: mapped, warnings: log.list };
}
