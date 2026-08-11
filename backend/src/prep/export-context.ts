// Generate per-company interview-prep context files under <ASSET_ROOT>/interview-prep/<slug>/.
//
// Each context.md is a single markdown dump of EVERYTHING the app knows about a company — recruiter
// notes + first-hand comments (comp / team / the real loop), the interview rounds, the fit
// assessment, the JD, and the researched prep profile + question set. The point: open one the agent
// chat per company, point it at that folder, and prep with the full context already on disk.
//
// Reads postings/interviews via Drizzle directly (NOT backend/src/db/queries) so it stays decoupled from the
// job-queue code; it reuses backend/src/db/prep for the researched profile + question folding. Shared by the
// CLI (`npm run prep:export`) and the in-app per-company "Dump context" button.
import fs from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { postings, companies, interviews } from "../db/schema";
import { getCompanyProfile, listQuestions, companySlug, type CompanyProfile, type PrepQuestion } from "../db/prep";
import { listPrepEmails, listTranscriptRows } from "../db/prep-assets";
import { exportTranscriptsFor } from "./transcripts";
import { PREP_ROOT, writeFresh } from "./root";
import type { InterviewRound, FitAssessment, Comment, EmailRefs, PrepEmail } from "@landed/shared/types";

// Re-exported: this module was the home of PREP_ROOT before the dumps split out, and it's what the
// routes, the chat, and the other prep helpers import.
export { PREP_ROOT };

const contextPath = (slug: string) => path.join(PREP_ROOT, slug, "context.md");
const questionsPath = (slug: string) => path.join(PREP_ROOT, slug, "questions.md");
const emailsPath = (slug: string) => path.join(PREP_ROOT, slug, "emails.md");

// A prep chat is scoped to one company's folder. Resolve <PREP_ROOT>/<slug> safely — null if the
// slug is empty or tries to escape the interview-prep tree (so a chat can never be pointed outside).
export function resolvePrepDir(slug: string): string | null {
  const root = path.resolve(PREP_ROOT);
  const full = path.resolve(root, slug);
  if (full === root || !full.startsWith(root + path.sep)) return null;
  return full;
}

export type PrepFile = { name: string; size: number; mtime: string };

// The markdown research outputs sitting in a directory (context.md, questions.md, …), newest first —
// the "context files" a prep chat is working from. Pure over the dir so it's unit-testable.
export function mdFilesIn(dir: string): PrepFile[] {
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return []; }
  return entries
    .filter((n) => n.toLowerCase().endsWith(".md"))
    .map((n) => {
      const st = fs.statSync(path.join(dir, n));
      return { name: n, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

// The context files on disk for one company's prep chat (empty if the slug is bad or nothing dumped).
export function listPrepFiles(slug: string): PrepFile[] {
  const dir = resolvePrepDir(slug);
  return dir ? mdFilesIn(dir) : [];
}

// Make sure a company's prep .md files exist before a chat cwds into the folder to read them. Dumps
// context.md / questions.md only when MISSING (the "Dump context" button force-refreshes from the
// DB). Best-effort: a cloud-sync write hiccup must never block the chat from opening.
//
// The knowledge dumps (emails.md, transcripts/) are refreshed even when context.md is already
// there — they only rewrite what changed, and they're the files the coach actually reads, so a chat
// opening on a stale one would be reading knowledge the DB has already moved past. When context.md
// IS being regenerated we let exportPrepContextFor do them, rather than writing every file twice.
export function ensurePrepFiles(slug: string): void {
  const regenerating = !prepContextDumpedAt(slug);
  try { if (regenerating) exportPrepContextFor(slug); } catch { /* best-effort */ }
  try { if (!questionsDumpedAt(slug)) exportQuestionsFor(slug); } catch { /* best-effort */ }
  if (regenerating) return;
  try { exportTranscriptsFor(slug); } catch { /* best-effort */ }
  try { exportEmailsFor(slug); } catch { /* best-effort */ }
}

type Co = {
  company: string; role: string; status: string; url?: string | null;
  comp?: string | null; teamNotes?: string | null; note?: string | null; jd?: string | null;
  comments: Comment[]; fit?: FitAssessment; fitScore?: number | null; rounds: InterviewRound[];
  emailRefs?: EmailRefs;
};

const KIND_LABEL: Record<string, string> = {
  recruiter_screen: "Recruiter screen", phone_screen: "Phone screen", technical: "Technical",
  system_design: "System design", behavioral: "Behavioral", onsite: "Onsite",
  hiring_manager: "Hiring manager", final: "Final", other: "Interview",
};
const TRACKERS: { key: PrepQuestion["track"][]; label: string }[] = [
  { key: ["coding"], label: "LeetCode" },
  { key: ["system_design"], label: "System Design" },
  { key: ["behavioral", "other"], label: "Other / bespoke" },
];

const parse = <T,>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

function roundsBlock(rounds: InterviewRound[]): string {
  if (!rounds.length) return "_No rounds recorded yet._";
  return rounds.map((r) => {
    const head = `${r.round ?? "?"}. **${KIND_LABEL[r.kind ?? "other"] ?? "Interview"}**`;
    const meta = [r.date, r.outcome && r.outcome !== "pending" ? r.outcome : null].filter(Boolean).join(" · ");
    return `${head}${meta ? ` — ${meta}` : ""}${r.notes ? `\n   - ${r.notes}` : ""}`;
  }).join("\n");
}

function fitBlock(c: Co): string {
  const f = c.fit;
  if (!f && c.fitScore == null) return "";
  const lines = [`## Fit assessment${c.fitScore != null ? ` (${c.fitScore})` : ""}`];
  if (f?.levelMatch?.call) lines.push(`- **Level:** ${f.levelMatch.call}${f.levelMatch.why ? ` — ${f.levelMatch.why}` : ""}`);
  if (f?.recommendation) lines.push(`- **Recommendation:** ${f.recommendation}`);
  if (f?.summary) lines.push(`\n${f.summary}`);
  if (f?.strengths?.length) lines.push(`\n**Strengths**\n` + f.strengths.map((s) => `- ${s}`).join("\n"));
  if (f?.gaps?.length) lines.push(`\n**Gaps**\n` + f.gaps.map((g) => `- ${g.text}${g.detail ? ` — ${g.detail}` : ""}`).join("\n"));
  return lines.join("\n");
}

function questionsBlock(questions: PrepQuestion[]): string {
  if (!questions.length) return "";
  const out: string[] = ["## Question set (reuses your shared LeetCode / System-Design banks)"];
  for (const t of TRACKERS) {
    const qs = questions.filter((q) => t.key.includes(q.track));
    if (!qs.length) continue;
    qs.sort((a, b) => (a.companyConfidence === "confirmed" ? 0 : 1) - (b.companyConfidence === "confirmed" ? 0 : 1));
    out.push(`\n### ${t.label} (${qs.length})`);
    for (const q of qs) {
      const tag = q.companyConfidence === "confirmed" ? "🟢 confirmed" : "🟡 likely";
      const bits = [q.leetcodeNum ? `LC ${q.leetcodeNum}` : null, q.difficulty || null].filter(Boolean).join(" · ");
      out.push(`- **${q.name}**${bits ? ` (${bits})` : ""} — ${tag}`);
      if (q.companyConfidenceReason) out.push(`  - why: ${q.companyConfidenceReason}`);
      if (q.companySource) out.push(`  - source: ${q.companySource}`);
      if (q.prompt) out.push(`  - ${q.prompt}`);
    }
  }
  return out.join("\n");
}

function profileBlock(profile: CompanyProfile | null): string {
  if (!profile) return "_No researched prep profile yet — run prep-research for this company._";
  const out: string[] = [];
  if (profile.overview) out.push(`### Company & product\n${profile.overview}`);
  if (profile.process) out.push(`### Interview process\n${profile.process}`);
  if (profile.rounds.length) out.push(`### Researched rounds\n` + profile.rounds.map((r) => `- **${r.name}**${r.format ? ` (${r.format})` : ""}${r.focus ? ` — ${r.focus}` : ""}`).join("\n"));
  if (profile.sources.length) out.push(`### Sources\n` + profile.sources.map((s) => `- ${s.url ? `[${s.label}](${s.url})` : s.label}`).join("\n"));
  return out.join("\n\n");
}

function commentsBlock(c: Co): string {
  if (!c.comments.length) return "";
  return `## Your intel (first-hand notes)\n` + c.comments.map((cm) => `- ${cm.text.replace(/\n/g, "\n  ")}`).join("\n");
}

// The Gmail thread ids captured by inbox-sync (per stage + per round). A SEED for the
// interview-emails job — those known threads are a starting point; the job also searches Gmail by
// company. The app only stores ids, never bodies. Empty when no email has been linked yet.
function emailManifestBlock(rows: Co[]): string {
  const seen = new Map<string, string>(); // thread id → label
  for (const c of rows) {
    const r = c.emailRefs ?? {};
    for (const [stage, id] of Object.entries(r)) if (id) seen.set(id, stage);
    for (const rd of c.rounds) if (rd.emailId) seen.set(rd.emailId, `round ${rd.round ?? "?"} (${rd.kind ?? "interview"})`);
  }
  if (!seen.size) return "";
  const lines = [...seen].map(([id, label]) => `- \`${id}\` — ${label}`);
  return (
    `## Known email threads (seed for Pull interview emails)\n` +
    `Gmail thread ids inbox-sync already linked — a starting point for the interview-emails job\n` +
    `(which also searches Gmail by company and writes \`emails.md\` + downloads attachments):\n` +
    lines.join("\n")
  );
}

// The call transcripts stored for this company. An INDEX, not the text — the full transcripts are
// dumped alongside in `transcripts/` and can run to thousands of lines, so context.md points at them
// rather than swallowing them. Keeps the same section heading it had when they were only files.
function transcriptsBlock(slug: string): string {
  const list = listTranscriptRows(slug);
  const head = `## Call transcripts`;
  if (!list.length) {
    return (
      `${head}\nNone captured yet. Paste one from the app's Interview stage — it's stored in Landed and\n` +
      `dumped into \`transcripts/\` in this folder, which the "Generate interview brief" job reads.`
    );
  }
  const lines = list.map((t) => `- \`transcripts/${t.name}\` — ${t.title ?? "(untitled)"} · ${t.at.slice(0, 10)}`);
  return `${head}\nFull text in \`transcripts/\` in this folder (dumped from Landed):\n${lines.join("\n")}`;
}

// The interview emails captured for this company — sender, date, subject, one per row, grouped by
// Gmail thread. Also an index: the bodies are dumped to `emails.md` next to this file.
function capturedEmailsBlock(slug: string): string {
  const list = listPrepEmails(slug);
  if (!list.length) return "";
  // Group by thread, carrying the thread id on the GROUP rather than encoding it into the map key —
  // mail with no thread id still needs a group, and sniffing that back out of a key string would
  // make the output depend on a sentinel a reader has to know about.
  const groups = new Map<string, { threadId?: string; mails: PrepEmail[] }>();
  for (const e of list) {
    const key = e.threadId ?? ` ${e.subject ?? ""}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { threadId: e.threadId, mails: [] }));
    g.mails.push(e);
  }
  const out = [
    `## Captured emails (${list.length})`,
    `Full text in \`emails.md\` in this folder (dumped from Landed):`,
  ];
  for (const g of groups.values()) {
    out.push(`- **${g.mails[0].subject ?? "(no subject)"}**${g.threadId ? ` · \`${g.threadId}\`` : ""}`);
    // A lone message with no headers to show would just repeat the line above it — that's what a
    // row backfilled from the old prose blob looks like. Only break a thread out per message when
    // the per-message lines actually say something the thread line didn't.
    const [only] = g.mails;
    if (g.mails.length === 1 && !only.from && !only.date && !only.round && !only.attachments?.length) continue;
    for (const m of g.mails) {
      const meta = [m.from, m.date?.slice(0, 10), m.round ? `round ${m.round}` : null].filter(Boolean).join(" · ");
      out.push(`  - ${m.subject ?? "(no subject)"}${meta ? ` — ${meta}` : ""}${m.attachments?.length ? ` · 📎 ${m.attachments.join(", ")}` : ""}`);
    }
  }
  return out.join("\n");
}

function buildContext(company: string, slug: string, rows: Co[], profile: CompanyProfile | null, questions: PrepQuestion[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const lead = rows[0];
  const out: string[] = [
    `# ${company} — interview prep`,
    `_Generated ${today} from Landed. The single place the agent should read to prep me for ${company}._`,
    "",
    `## Roles in play`,
    ...rows.map((r) => `- **${r.role || "(untitled)"}** — ${r.status}${r.url ? ` · ${r.url}` : ""}`),
  ];
  if (lead.note) out.push(`\n## Recruiter / status note\n${lead.note}`);
  const intel = rows.map(commentsBlock).filter(Boolean).join("\n");
  if (intel) out.push(`\n${intel}`);
  const comp = rows.map((r) => r.comp).find(Boolean);
  if (comp) out.push(`\n## Comp structure\n${comp}`);
  const team = rows.map((r) => r.teamNotes).find(Boolean);
  if (team) out.push(`\n## Team · product · work\n${team}`);
  out.push(`\n## Interview loop\n${roundsBlock(lead.rounds)}`);
  const fit = rows.map(fitBlock).filter(Boolean).join("\n\n");
  if (fit) out.push(`\n${fit}`);
  out.push(`\n## Researched prep profile\n${profileBlock(profile)}`);
  const qs = questionsBlock(questions);
  if (qs) out.push(`\n${qs}`);
  const jd = rows.map((r) => r.jd).find(Boolean);
  if (jd) out.push(`\n## Job description\n\n\`\`\`\n${jd}\n\`\`\``);
  const captured = capturedEmailsBlock(slug);
  if (captured) out.push(`\n${captured}`);
  const emails = emailManifestBlock(rows);
  if (emails) out.push(`\n${emails}`);
  out.push(`\n${transcriptsBlock(slug)}`);
  out.push(
    `\n---\n## How to use this in an agent chat`,
    `Open a Claude Code / the agent chat in this asset folder and start with something like:`,
    `> Read interview-prep/${slug}/context.md. You're my interview-prep coach for ${company}. Help me prep — quiz me, pressure-test answers, suggest variations, and dig into anything I'm weak on.`,
  );
  return out.join("\n") + "\n";
}

// The display name behind a canonical slug ("pendo" → "Pendo"), or null if no company matches. The
// slug is the folder key, so a dump can resolve its own heading rather than depending on the caller
// to pass one — two callers passing different things is how a file ends up flip-flopping its title.
function companyNameFor(slug: string): string | null {
  return db.select().from(companies).all().find((c) => companySlug(c.name) === slug)?.name ?? null;
}

// Map an interviews row → the InterviewRound shape, then sort by round number.
function roundsFor(appId: number): InterviewRound[] {
  return db.select().from(interviews).where(eq(interviews.applicationId, appId)).all()
    .map((iv): InterviewRound => ({ round: iv.round ?? undefined, kind: (iv.kind as InterviewRound["kind"]) ?? undefined, date: iv.date ?? undefined, outcome: (iv.outcome as InterviewRound["outcome"]) ?? undefined, notes: iv.notes ?? undefined, emailId: iv.emailId ?? undefined }))
    .sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
}

// Gather a company's postings (by canonical slug). Prefers interview/offer rows; falls back to all
// of the company's postings so the button works on any company prep page. Returns null if unknown.
function gatherCompany(slug: string): { company: string; rows: Co[] } | null {
  const cos = db.select().from(companies).all().filter((c) => companySlug(c.name) === slug);
  if (!cos.length) return null;
  const ids = cos.map((c) => c.id);
  const all = db.select().from(postings).innerJoin(companies, eq(postings.companyId, companies.id))
    .where(inArray(postings.companyId, ids)).all();
  if (!all.length) return { company: cos[0].name, rows: [] };
  const inStage = all.filter((r) => r.postings.state === "interview" || r.postings.state === "offer");
  const use = inStage.length ? inStage : all;
  const rows = use.map((r): Co => {
    const p = r.postings;
    return {
      company: r.companies.name, role: p.title ?? "", status: p.state, url: p.url,
      comp: p.comp, teamNotes: p.teamNotes, note: p.note, jd: p.jd,
      comments: parse<Comment[]>(p.comments, []), fit: parse<FitAssessment | undefined>(p.fitDetail, undefined),
      fitScore: p.fitScore, rounds: roundsFor(p.id), emailRefs: parse<EmailRefs>(p.emailRefs, {}),
    };
  });
  return { company: rows[0].company, rows };
}

// ── The knowledge dumps ───────────────────────────────────────────────────────────────────────
// `emails.md` and `transcripts/*.md` are GENERATED from the DB, exactly like context.md — the rows
// are the record and nothing reads these back. They exist so the interview-brief job and a
// per-company prep chat keep working off a folder of markdown, as they always have.
// (The transcripts half lives with its writer, in ./transcripts.ts.)

// Regenerate `emails.md` from the stored emails — one section per message, chronological, with the
// headers that made per-row storage worth doing. A row imported from the pre-migration prose blob
// (source `backfill`, so no sender/date/thread) is emitted verbatim under its own heading, which is
// what keeps a company captured before the migration reading the same as it did before.
export function exportEmailsFor(slug: string): { at: string } | null {
  const list = listPrepEmails(slug);
  if (!list.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [
    `# ${companyNameFor(slug) ?? slug} — interview emails`,
    `_Generated ${today} from Landed — regenerated from the database, so edits here are overwritten._`,
  ];
  for (const e of list) {
    const bare = !e.from && !e.date && !e.threadId; // a backfilled prose blob — it carries its own headings
    if (bare) { out.push(`\n---\n`, e.body.trimEnd()); continue; }
    const meta = [
      e.from ? `**From:** ${e.from}` : null,
      e.date ? `**Date:** ${e.date}` : null,
      e.threadId ? `**Thread:** \`${e.threadId}\`` : null,
      e.round ? `**Round:** ${e.round}` : null,
      e.attachments?.length ? `**Attachments:** ${e.attachments.join(", ")}` : null,
    ].filter(Boolean).join(" · ");
    out.push(`\n---\n`, `## ${e.subject ?? "(no subject)"}`, meta, ``, e.body.trimEnd());
  }
  writeFresh(emailsPath(slug), out.join("\n") + "\n");
  return { at: new Date().toISOString() };
}

// Write (or refresh) one company's context.md — and the knowledge dumps it indexes, so the folder is
// never half-regenerated. Returns the ISO timestamp it was written, or null if the slug doesn't
// resolve to a company.
export function exportPrepContextFor(slug: string): { at: string } | null {
  const g = gatherCompany(slug);
  if (!g) return null;
  const profile = getCompanyProfile(slug);
  const questions = profile ? listQuestions({ company: slug }) : [];
  // Best-effort: a cloud-sync write hiccup on one dump must not cost us the context file.
  try { exportTranscriptsFor(slug); } catch { /* dump is best-effort */ }
  try { exportEmailsFor(slug); } catch { /* dump is best-effort */ }
  fs.mkdirSync(path.dirname(contextPath(slug)), { recursive: true });
  fs.writeFileSync(contextPath(slug), buildContext(g.company, slug, g.rows, profile, questions));
  return { at: new Date().toISOString() };
}

// When the context.md for a company was last written (file mtime), or null if none yet.
export function prepContextDumpedAt(slug: string): string | null {
  try { return fs.statSync(contextPath(slug)).mtime.toISOString(); } catch { return null; }
}

// Standalone question-research output (`questions.md`) — the PURELY ONLINE-researched question bank
// from the prep-research job: the researched process, rounds, and question set (with confidence +
// sources), as a clean file to work from in a per-company the agent prep chat (separate from the full
// context.md dump). Returns the write time, or null if the slug has no researched profile yet.
export function exportQuestionsFor(slug: string): { at: string } | null {
  const g = gatherCompany(slug);
  const profile = getCompanyProfile(slug);
  if (!g || !profile) return null;
  const questions = listQuestions({ company: slug });
  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [
    `# ${g.company} — interview questions (online research)`,
    `_Researched ${today}. Public-source question bank from the prep-research job — 🟢 confirmed = reported as actually asked, 🟡 likely = predicted. Cross-check against your own recruiter intel._`,
  ];
  if (profile.process) out.push(`\n## Interview process\n${profile.process}`);
  if (profile.rounds.length) out.push(`\n## Rounds\n` + profile.rounds.map((r) => `- **${r.name}**${r.format ? ` (${r.format})` : ""}${r.focus ? ` — ${r.focus}` : ""}`).join("\n"));
  const qs = questionsBlock(questions);
  if (qs) out.push(`\n${qs}`);
  if (profile.sources.length) out.push(`\n## Sources\n` + profile.sources.map((s) => `- ${s.url ? `[${s.label}](${s.url})` : s.label}`).join("\n"));
  fs.mkdirSync(path.join(PREP_ROOT, slug), { recursive: true });
  fs.writeFileSync(questionsPath(slug), out.join("\n") + "\n");
  return { at: new Date().toISOString() };
}

// When questions.md was last written (file mtime), or null if none yet.
export function questionsDumpedAt(slug: string): string | null {
  try { return fs.statSync(questionsPath(slug)).mtime.toISOString(); } catch { return null; }
}

// Export EVERY interview/offer-stage company + a README index. Used by the CLI.
export function exportAllPrepContext(): { slug: string; company: string }[] {
  const rows = db.select().from(postings).innerJoin(companies, eq(postings.companyId, companies.id))
    .where(inArray(postings.state, ["interview", "offer"])).all();
  const seen = new Map<string, string>(); // slug → company name
  for (const r of rows) seen.set(companySlug(r.companies.name), r.companies.name);

  fs.mkdirSync(PREP_ROOT, { recursive: true });
  const done: { slug: string; company: string }[] = [];
  const index: string[] = [];
  for (const [slug, company] of seen) {
    exportPrepContextFor(slug);
    const profile = getCompanyProfile(slug);
    index.push(`- **${company}** → [\`${slug}/context.md\`](${slug}/context.md)${profile ? "" : " · _no prep profile yet_"}`);
    done.push({ slug, company });
  }
  const readme = [
    `# Interview prep`, ``,
    `One subfolder per company I'm interviewing with. Each \`<slug>/context.md\` is a full dump of`,
    `everything Landed knows about that company — my notes + first-hand intel, the interview`,
    `loop, the fit assessment, the JD, and the researched prep profile + question set.`, ``,
    `**To prep:** open an agent chat per company and point it at that company's \`context.md\`.`,
    `Regenerate from the app (each company's "Dump context" button) or all at once with`,
    `\`npm run prep:export\`. Overwrites context.md; never deletes folders, so notes you add survive.`, ``,
    `## Companies`, ...index, ``,
  ].join("\n");
  fs.writeFileSync(path.join(PREP_ROOT, "README.md"), readme);
  return done;
}
