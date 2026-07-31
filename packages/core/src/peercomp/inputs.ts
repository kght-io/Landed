import fs from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { postings, companies } from "../db/schema";
import { canonical } from "@landed/shared/agents/canonical";
import { PREP_ROOT } from "../prep/export-context";

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

// Gather one entry per posting in the interview/offer stage, with whatever comp signal we have on
// disk + in the DB. Pure DB/FS read — unit-testable, no model call.
export function gatherPeerInputs(): RoleInput[] {
  const coName = new Map(db.select().from(companies).all().map((c) => [c.id, c.name] as const));
  const rows = db.select().from(postings).where(inArray(postings.state, ["interview", "offer"])).all();
  return rows.map((r) => {
    const company = coName.get(r.companyId) ?? "";
    const slug = canonical(company)?.key;
    let emails: string | undefined;
    if (slug) {
      const p = path.join(PREP_ROOT, slug, "emails.md");
      try {
        emails = fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() || undefined : undefined;
      } catch {
        emails = undefined;
      }
    }
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
