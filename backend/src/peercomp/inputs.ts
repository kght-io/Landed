import { inArray } from "drizzle-orm";
import { db } from "../db";
import { postings, companies } from "../db/schema";
import { companySlug } from "../db/prep";
import { listPrepEmails } from "../db/prep-assets";

// The raw comp signal the app already holds for one interviewing role: stored comp notes + JD +
// whatever recruiter emails inbox capture wrote to disk. The peer-comp the agent job embeds this roster
// into its task so the agent starts from ground truth, then researches externally to fill gaps.
//
// Comp jottings land in more than one place: the dedicated `comp` ("Comp structure") field, but also
// the general `note` field (where post-recruiter-call notes and inbox-sync's recruiter-email text go)
// and `teamNotes` (team/stage/role context). We embed all three so figures are captured wherever they
// were typed — the agent extracts comp from the free text.
export type RoleInput = { company: string; role: string; comp?: string; note?: string; teamNotes?: string; jd?: string; emails?: string };

const CLIP = 4000; // per-field char cap so long JDs/emails don't blow the task instruction
const clip = (s: string, n = CLIP) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);

// Gather one entry per posting in the interview/offer stage, with whatever comp signal we have in
// the DB. Pure DB read — unit-testable, no model call.
//
// The captured emails used to be read off `interview-prep/<slug>/emails.md`; they're rows now
// (db/prep-assets.ts), so this renders the bodies back into one block per company. Same text the
// agent used to see, minus the dependence on a file that only existed on the user's laptop.
export function gatherPeerInputs(): RoleInput[] {
  const coName = new Map(db.select().from(companies).all().map((c) => [c.id, c.name] as const));
  const rows = db.select().from(postings).where(inArray(postings.state, ["interview", "offer"])).all();
  return rows.map((r) => {
    const company = coName.get(r.companyId) ?? "";
    const mail = company ? listPrepEmails(companySlug(company)) : [];
    const emails = mail.length
      ? mail
          .map((e) => [[e.subject, e.from, e.date].filter(Boolean).join(" · "), e.body.trim()].filter(Boolean).join("\n"))
          .join("\n\n")
          .trim() || undefined
      : undefined;
    return {
      company,
      role: r.title,
      comp: r.comp?.trim() || undefined,
      note: r.note?.trim() || undefined,
      teamNotes: r.teamNotes?.trim() || undefined,
      jd: r.jd?.trim() || undefined,
      emails,
    };
  });
}

// Render the roster into the peer-comp job's task instruction. One block per role with its stored
// comp notes / recruiter emails / JD (each clipped). Roles with no stored signal are still listed so
// the agent knows the full set and researches them from its own knowledge.
export function renderRoster(roles: RoleInput[]): string {
  return roles
    .map((r, i) => {
      const parts = [`### ${i + 1}. ${r.company} — ${r.role}`];
      if (r.comp) parts.push(`My comp notes:\n${clip(r.comp)}`);
      if (r.note) parts.push(`My notes (may include comp from recruiter calls):\n${clip(r.note)}`);
      if (r.teamNotes) parts.push(`Team / stage / role notes:\n${clip(r.teamNotes)}`);
      if (r.emails) parts.push(`Recruiter emails (captured):\n${clip(r.emails)}`);
      if (r.jd) parts.push(`Job description:\n${clip(r.jd)}`);
      if (!r.comp && !r.note && !r.teamNotes && !r.emails && !r.jd) parts.push("(no stored comp data — use your own knowledge, mark unknowns)");
      return parts.join("\n\n");
    })
    .join("\n\n---\n\n");
}
