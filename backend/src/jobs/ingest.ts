import { eq } from "drizzle-orm";
import { db } from "../db";
import { companies, postings } from "../db/schema";
import type { CompanyRow, PostingRow } from "../db/schema";
import { logEvent, enqueueUnboundResult, upsertInterviews } from "../db/queries";
import { isCompanyCooling } from "../db/cooldown";
import { reconcile } from "../agents/reconcile";
import { incomingFromInboxRecords, incomingRounds } from "@landed/shared/agents/sources/inbox";
import { canonical, norm } from "@landed/shared/agents/canonical";
import { ingestPrepRecords, ingestPrepResearch, ingestLeetcodeAdd, companySlug } from "../db/prep";
import { exportPrepContextFor, exportQuestionsFor } from "../prep/export-context";
import { str, num, describeWarnings } from "@landed/shared/util/coerce";
import { parseRedoLog, nextVersion } from "@landed/shared/jobs/redolog";
import { parseBriefs, nextBriefVersion, coerceGaps, coerceSourced } from "@landed/shared/jobs/briefs";
import { gatherPeerInputs, renderRoster } from "../peercomp/inputs";
import { setPeerComp } from "./peercomps";
import { coerceDiff } from "@landed/shared/util/linediff";
import type { FitAssessment, InterviewBrief, RedoTurn } from "@landed/shared/types";
import type { ChangeDetail, ReconcileResult } from "@landed/shared/agents/types";
import type { ResultRecord } from "@landed/shared/jobs/types";


// ── how each job type turns an agent's result into database rows ──
// One `ingest(records, dryRun)` per job type, plus the helpers they share. These are the bodies the
// registry points at; the registry itself (./registry.ts) is just the table that names them, so it
// stays readable as a list of what job types exist rather than 300 lines of matching and patching.
//
// Every one of these runs INSIDE submitJobResult, after its claim gate — so a body here can assume
// the job was really claimed and this is really its first ingest. `dryRun` previews without
// persisting (reconcile rolls back), which is how the agent asks "what would this change?".

// Fit + tailoring update the matching POSTING (discovery side of the unified model). Match by id
// (echoed back), else company + url/role, preferring the fit-phase rows; apply the patch.
export function ingestCandidateUpdates(
  records: ResultRecord[],
  dryRun: boolean | undefined,
  source: string,
  label: string,
  // `next` = columns to set on the posting (omit/empty when the result writes elsewhere).
  // `apply` = a write to another table, run only on a real (non-dry) run — how interview-emails
  // lands its rounds without inventing a second copy of the id-match + unbound-alert plumbing.
  build: (r: ResultRecord, cand: PostingRow, co: CompanyRow) => { next?: Record<string, unknown>; summary: string; apply?: () => void } | null,
): ReconcileResult {
  const coByKey = new Map<string, CompanyRow>();
  const coById = new Map<number, CompanyRow>();
  for (const co of db.select().from(companies).all()) {
    coById.set(co.id, co);
    const key = canonical(co.name)?.key;
    if (key) coByKey.set(key, co);
  }
  const byCo = new Map<number, PostingRow[]>();
  const byId = new Map<number, PostingRow>();
  for (const c of db.select().from(postings).all()) {
    byId.set(c.id, c);
    (byCo.get(c.companyId) ?? byCo.set(c.companyId, []).get(c.companyId)!).push(c);
  }
  // ID-ONLY. The posting `id` is the stable round-trip key the app stamped on the job and the agent
  // echoes back — title/url guessing here risks binding the result onto the wrong posting, so it
  // was removed. An id that doesn't resolve raises a human-action item instead of silently skipping.
  const match = (r: ResultRecord): { co: CompanyRow; cand: PostingRow } | null => {
    const id = num(r.id);
    if (id == null) return null;
    const cand = byId.get(id);
    const co = cand ? coById.get(cand.companyId) : undefined;
    return cand && co ? { co, cand } : null;
  };

  // The id didn't resolve — park an "unbound result" alert (dismiss-only) so it's visible in the
  // Changes inbox rather than dropped. Best-effort company resolution (needed for the FK); same-title
  // postings under that company become hints. Idempotent via enqueueUnboundResult's signature.
  const raiseUnbound = (r: ResultRecord) => {
    const key = canonical(str(r.company) ?? "")?.key;
    const co = key ? coByKey.get(key) : undefined;
    if (!co) { logEvent({ actor: "CoWork", source, action: "flag", summary: `${source} result for id ${num(r.id) ?? "?"} — no matching posting or company (skipped)` }); return; }
    const rn = norm(str(r.role) ?? "");
    const hintIds = rn ? (byCo.get(co.id) ?? []).filter((x) => norm(x.title) === rn).map((x) => x.id) : [];
    enqueueUnboundResult({
      source, companyId: co.id, companyName: co.name, jobType: source,
      declaredId: num(r.id) ?? undefined, role: str(r.role) ?? null, record: r, candidateIds: hintIds,
    });
  };

  const details: ChangeDetail[] = [];
  let updated = 0;
  let unbound = 0;
  for (const r of records) {
    const m = match(r);
    if (!m) {
      if (!dryRun) raiseUnbound(r);
      details.push({ action: "flag", summary: `${source} result · id ${num(r.id) ?? "?"} not found → needs your review` });
      unbound++;
      continue;
    }
    const built = build(r, m.cand, m.co);
    if (!built) continue;
    details.push({ action: "update", summary: built.summary });
    if (!dryRun) {
      if (built.next && Object.keys(built.next).length) db.update(postings).set(built.next).where(eq(postings.id, m.cand.id)).run();
      built.apply?.();
      logEvent({ actor: "CoWork", source, entity: "company", entityId: m.co.id, action: "update", summary: built.summary });
    }
    updated++;
  }
  const summary = unbound ? `${updated} ${label} · ${unbound} unbound (needs review)` : `${updated} ${label}`;
  return { inserted: 0, updated, fieldChanges: updated, flagged: 0, pending: unbound, newCompanies: 0, summary, details };
}

// interview-emails record { id, rounds:[...] }: the deep per-company read of the interviewing
// threads. It still writes emails.md + attachments for agent chat, but the loop itself — who you're
// meeting, exactly when, the format, what they said to expect, how they said to prepare — now lands
// on the `interviews` rows so the drawer can show it. Before this it existed only as prose in a file
// nothing in the app read.
//
// Division of labour: inbox-sync (cheap, global, daily) owns stage + kind/date/outcome; this owns
// the substance. upsertInterviews merges per field, so each writer's silence preserves the other's
// values — but where this job DOES report a date or outcome it wins, because it read the whole
// thread rather than classifying one email.
export function ingestInterviewLoop(records: ResultRecord[], dryRun?: boolean): ReconcileResult {
  return ingestCandidateUpdates(records, dryRun, "interview-emails", "loops captured", (r, cand, co) => {
    const rounds = incomingRounds(r.rounds ?? r.interviews);
    if (!rounds?.length) return null; // asset-only run (emails.md written, nothing structured to land)
    const n = upsertInterviews(cand.id, rounds, { dryRun: true }); // count first — the summary needs it
    if (!n) return null; // re-capture with nothing new
    return {
      summary: `${co.name} — ${cand.title} · ${n} interview round${n === 1 ? "" : "s"} detailed`,
      apply: () => { upsertInterviews(cand.id, rounds); },
    };
  });
}

// tailoring record { company, role, slug, note }: the agent tailored a resume into resume/<slug>/.
// The slug is the versioned folder the app told it to write (resume/<base>/v<N>/); `note` is the
// "what changed & why" that becomes this version's agent turn in the redo conversation.
export function ingestTailoring(records: ResultRecord[], dryRun?: boolean): ReconcileResult {
  return ingestCandidateUpdates(records, dryRun, "tailoring", "tailored", (r, cand, co) => {
    const slug = str(r.slug);
    if (!slug) return null;
    // Append this attempt as a versioned agent turn; resume_dir/state project the latest version.
    const log = parseRedoLog(cand.redoLog);
    const version = nextVersion(log, "tailor");
    const note = str(r.note) ?? "Tailored the base resume to the posting.";
    // the agent's annotated tailored-vs-base diff (each changed line + why). Optional — when absent the
    // diff view falls back to the computed textutil diff.
    const diff = coerceDiff(r.diff);
    const turn: RedoTurn = { phase: "tailor", role: "agent", at: new Date().toISOString(), text: note, version, slug, ...(diff ? { diff } : {}) };
    return {
      next: { resumeDir: slug, state: "tailored", redoLog: JSON.stringify([...log, turn]) },
      summary: `${co.name} — ${cand.title} · tailored v${version} → ${slug}`,
    };
  });
}

// Normalize a fit result record into the stored FitAssessment. levelMatch may arrive as an
// object {call, why} or a bare string; summary may be `summary` or `fitSummary`.
export function buildFitDetail(r: ResultRecord): FitAssessment {
  const lm = r.levelMatch;
  return {
    levelMatch: typeof lm === "string" ? { call: lm } : (lm as FitAssessment["levelMatch"]),
    recommendation: str(r.recommendation),
    summary: str(r.summary) ?? str(r.fitSummary),
    strengths: Array.isArray(r.strengths) ? r.strengths : undefined,
    gaps: Array.isArray(r.gaps) ? (r.gaps as FitAssessment["gaps"]) : undefined,
  };
}

// fit record (rich): { company, role, fitScore, levelMatch{call,why}, recommendation,
// summary, strengths[], gaps[{text,severity,detail}] }. Store fitScore for quick sort/badge
// and the full assessment as a JSON blob (fit_detail); advance discovered → assessed.
export function ingestFit(records: ResultRecord[], dryRun?: boolean): ReconcileResult {
  return ingestCandidateUpdates(records, dryRun, "fit", "scored", (r, cand, co) => {
    const score = num(r.fitScore);
    const detail = buildFitDetail(r);
    // Append this assessment as a versioned agent turn; fit_score/fit_detail project the latest.
    const log = parseRedoLog(cand.redoLog);
    const version = nextVersion(log, "fit");
    const turn: RedoTurn = {
      phase: "fit", role: "agent", at: new Date().toISOString(),
      text: detail.summary ?? `Fit ${score ?? "?"} (${detail.levelMatch?.call ?? "?"})`,
      version, fitScore: score ?? undefined, fit: detail,
    };
    const next: Record<string, unknown> = { fitScore: score, fitDetail: JSON.stringify(detail), redoLog: JSON.stringify([...log, turn]) };
    const jd = str(r.jd);
    if (jd) next.jd = jd; // persist the JD the agent used so tailoring reuses it (no re-fetch)
    if (cand.state === "fit_queue") next.state = "assessed";
    return { next, summary: `${co.name} — ${cand.title} · fit v${version} ${score ?? "?"} (${detail.levelMatch?.call ?? "?"})` };
  });
}

// interview-brief record: { id, role?, tc?, team?, expectations?, nextStep? (each a string or
// {text, source}), gaps:[{area,why,severity,source}], summary?, materials?|sources? }. The agent read
// the interview-prep asset folder (context.md + transcripts + emails.md + attachments) and
// synthesized a source-tagged overview. Append it as a new version to interview_briefs; the drawer
// projects the latest. ID-only match (the posting id the app stamped on the job).
export function ingestInterviewBrief(records: ResultRecord[], dryRun?: boolean): ReconcileResult {
  return ingestCandidateUpdates(records, dryRun, "interview-brief", "briefed", (r, cand, co) => {
    const list = parseBriefs(cand.interviewBriefs);
    const version = nextBriefVersion(list);
    const mats = r.materials ?? r.sources;
    const brief: InterviewBrief = {
      version,
      generatedAt: new Date().toISOString(),
      role: coerceSourced(r.role),
      tc: coerceSourced(r.tc ?? r.totalComp ?? r.comp),
      team: coerceSourced(r.team),
      expectations: coerceSourced(r.expectations ?? r.lookingFor),
      nextStep: coerceSourced(r.nextStep ?? r.next),
      gaps: coerceGaps(r.gaps),
      summary: str(r.summary) ?? str(r.overview) ?? undefined,
      materials: Array.isArray(mats) ? mats.map(String).filter(Boolean) : undefined,
    };
    return {
      next: { interviewBriefs: JSON.stringify([...list, brief]) },
      summary: `${co.name} — ${cand.title} · interview brief v${version}`,
    };
  });
}

// peer-comp record: ONE { markdown } — the full comp comparison (6-column table + prose synthesis)
// The agent produced across every actively-interviewing role. GLOBAL (not tied to a posting), so it
// doesn't use ingestCandidateUpdates: just persist the markdown as the latest artifact in app_config
// (latest-only, overwrites). See backend/src/jobs/peercomps.ts.
export function ingestPeerComp(records: ResultRecord[], dryRun?: boolean): ReconcileResult {
  const markdown = records.map((r) => str(r.markdown)).find(Boolean);
  if (!markdown) {
    return { inserted: 0, updated: 0, fieldChanges: 0, flagged: 0, pending: 0, newCompanies: 0, summary: "no peer-comp markdown in result", details: [] };
  }
  if (!dryRun) setPeerComp(markdown, new Date().toISOString());
  return { inserted: 0, updated: 1, fieldChanges: 1, flagged: 0, pending: 0, newCompanies: 0, summary: "peer-comp comparison updated", details: [{ action: "update", summary: "peer-comp comparison updated" }] };
}

// prep record: { leetcodeNum?|name, status, durationSec?, notes?, noted?, redo?, ... }.
// The agent logged a coding practice attempt; ingestPrepRecords resolves it to a catalog
// question (or inserts a new one) and appends the attempt. Doesn't touch applications.
export function ingestPrep(records: ResultRecord[], dryRun?: boolean): ReconcileResult {
  const r = ingestPrepRecords(records, dryRun);
  const parts: string[] = [];
  if (r.attempts) parts.push(`${r.attempts} attempt${r.attempts === 1 ? "" : "s"}`);
  if (r.inserted) parts.push(`${r.inserted} new question${r.inserted === 1 ? "" : "s"}`);
  if (r.flagged) parts.push(`${r.flagged} flagged`);
  return {
    inserted: r.inserted,
    updated: r.attempts,
    fieldChanges: r.attempts + r.flagged,
    flagged: r.flagged,
    pending: 0,
    newCompanies: 0,
    summary: parts.join(", ") || "no prep changes",
    details: r.details,
  };
}

// leetcode-add record: { id, name?, difficulty?, topic?|pattern?, leetcodeNum? }. The agent resolved a
// manually-added stub's real name/difficulty/topic from its URL; ingestLeetcodeAdd fills the row by id.
export function ingestLeetcodeAddJob(records: ResultRecord[], dryRun?: boolean): ReconcileResult {
  const r = ingestLeetcodeAdd(records, dryRun);
  return {
    inserted: 0,
    updated: r.enriched,
    fieldChanges: r.enriched,
    flagged: 0,
    pending: 0,
    newCompanies: 0,
    summary: r.enriched ? `${r.enriched} leetcode question${r.enriched === 1 ? "" : "s"} enriched` : "no leetcode changes",
    details: r.details,
  };
}

// prep-research record batch: one { type:"profile", company, process, rounds[], categories[],
// sources[] } + N { type:"question", company, category, track?, name, leetcodeNum?|prompt, ... }.
// The agent researched a company's interview process; ingestPrepResearch upserts the profile and
// tags/creates questions (reusing the shared bank by leetcodeNum so progress carries over).
export function ingestPrepResearchJob(records: ResultRecord[], dryRun?: boolean): ReconcileResult {
  const r = ingestPrepResearch(records, dryRun);
  // "Research questions" is one of the three asset inputs — refresh the company's context.md dump and
  // write the standalone questions.md (online-research question bank) so the interview-brief job + a
  // per-company the agent prep chat can read the fresh research. Best-effort; never breaks the ingest.
  if (!dryRun) {
    const company = records.map((rec) => str(rec.company)).find(Boolean);
    const slug = company ? companySlug(company) : null;
    if (slug) { try { exportPrepContextFor(slug); exportQuestionsFor(slug); } catch { /* dump is best-effort */ } }
  }
  const parts: string[] = [];
  if (r.profile) parts.push("profile");
  if (r.reused) parts.push(`${r.reused} reused`);
  if (r.inserted) parts.push(`${r.inserted} new question${r.inserted === 1 ? "" : "s"}`);
  return {
    inserted: r.inserted,
    updated: r.reused + r.profile,
    fieldChanges: r.reused + r.inserted + r.profile,
    flagged: 0,
    pending: 0,
    newCompanies: 0,
    summary: parts.join(", ") || "no prep-research changes",
    details: r.details,
  };
}

// Ingest for the watchlist-scan source (legacy submitJobResult path; the live flow is
// submitGlance). Land each surfaced posting as a fit_queue CANDIDATE — it enters discovery,
// never an application. New companies are created on the fly.
export function ingestDiscovered(source: string) {
  return (records: ResultRecord[], dryRun?: boolean): ReconcileResult => {
    const details: ChangeDetail[] = [];
    let inserted = 0, updated = 0;
    // One "today" for the whole batch: a scan result is judged against the day it's ingested, and
    // this keeps the cooldown check from re-deriving the date per record.
    const at = new Date().toISOString().slice(0, 10);
    for (const r of records) {
      const company = str(r.company) ?? "";
      const key = canonical(company)?.key;
      if (!key) continue;
      const role = str(r.role) ?? "(untitled)";
      const url = str(r.url);
      let co = db.select().from(companies).all().find((c) => canonical(c.name)?.key === key);
      if (!co) {
        if (dryRun) { details.push({ action: "insert", summary: `${company} — ${role} · would add (new company) → fit queue` }); inserted++; continue; }
        const ts = new Date().toISOString();
        co = db.insert(companies).values({ name: company, tier: "tier3", createdAt: ts, updatedAt: ts }).returning().get();
      }
      // A company cooling off after rejecting you gets its finds filed away instead of queued: the
      // row is kept (so it's there when the cooldown lapses) but it never reaches the funnel, and
      // no fit work is spent on it.
      const cooling = isCompanyCooling(co, at);
      const state = cooling ? "filtered" : "fit_queue";
      const where = cooling ? "filed (company cooling off)" : "fit queue";
      const list = db.select().from(postings).where(eq(postings.companyId, co.id)).all();
      const existing = (url ? list.find((c) => c.url === url) : undefined) ?? list.find((c) => c.title.toLowerCase() === role.toLowerCase());
      if (existing) {
        // Don't drag a row BACK out of the funnel just because the company is now cooling — that's
        // the read-side's job, and demoting live work here would lose it.
        if (!dryRun && !cooling) db.update(postings).set({ state }).where(eq(postings.id, existing.id)).run();
        details.push({ action: "update", summary: `${co.name} — ${role} · → ${where}` }); updated++;
      } else {
        if (!dryRun) db.insert(postings).values({ companyId: co.id, title: role, location: str(r.location) ?? null, url: url ?? null, department: null, verdict: cooling ? "dropped" : "kept", reason: cooling ? "cooldown" : null, state, scannedAt: new Date().toISOString() }).run();
        details.push({ action: "insert", summary: `${co.name} — ${role} · added to ${where}` }); inserted++;
      }
      if (!dryRun) logEvent({ actor: "CoWork", source, entity: "company", entityId: co.id, action: existing ? "update" : "insert", summary: `${co.name} — ${role} · watchlist-scan → ${where}` });
    }
    return { inserted, updated, fieldChanges: updated, flagged: 0, pending: 0, newCompanies: 0, summary: `${inserted} added, ${updated} requeued`, details };
  };
}

// watchlist-add has no submitJobResult ingest — The agent writes directly via upsertCompanies +
// addToWatchlist. The def exists so it shows as a job (with its playbook); ingest is a no-op.
export const noopIngest = (): ReconcileResult => ({ inserted: 0, updated: 0, fieldChanges: 0, flagged: 0, pending: 0, newCompanies: 0, summary: "", details: [] });

// Shared body of the fit/tailoring `onUnqueue` hooks: move the posting out of the waiting stage the
// enqueue put it in, so deleting the job actually sticks. `guard` is the extra condition that tells a
// first-time run (which owns the stage) from a redo (which doesn't — its artifact is already live and
// must survive the delete untouched).
export function unqueueCandidate(
  postingId: number | null,
  opts: { from: PostingRow["state"]; to: PostingRow["state"]; source: string; label: string; guard?: (c: PostingRow) => boolean },
): void {
  if (postingId == null) return;
  const cand = db.select().from(postings).where(eq(postings.id, postingId)).get();
  if (!cand || cand.state !== opts.from || (opts.guard && !opts.guard(cand))) return;
  db.update(postings).set({ state: opts.to }).where(eq(postings.id, cand.id)).run();
  const co = db.select().from(companies).where(eq(companies.id, cand.companyId)).get();
  logEvent({
    entity: "company", entityId: cand.companyId, action: "update", source: opts.source,
    summary: `${co?.name ?? "?"} — ${cand.title} · un-queued from ${opts.label} (removed from the agent queue)`,
  });
}

// Ordered by pipeline stage (ascending): create → scan → fit → tailor → inbox sync.

// An inbox sync never edits the tracker directly — `approval: true` parks every change it derived
// from your mail on the Changes page for you to confirm. The mapper reports what it had to
// substitute and reconcile reports what it had to drop; both land on the job summary, so an agent
// result we only half-understood never reads as a clean run. (describeWarnings returns "" when
// there's nothing to say.)
export function ingestInboxSync(records: ResultRecord[], dryRun?: boolean): ReconcileResult {
  const { records: incoming, warnings } = incomingFromInboxRecords(records);
  const result = reconcile(incoming, { actor: "CoWork", source: "inbox-sync", dryRun, approval: true });
  const note = describeWarnings(warnings);
  return note ? { ...result, summary: `${result.summary} · ${note}` } : result;
}

// The peer-comp task carries its own input: every role currently in the interview/offer stage, with
// whatever comp notes we already have. Built at queue time so the agent gets the roster as it stands
// when the job is created, not when it eventually runs.
export function peerCompTask(): string {
  const roster = gatherPeerInputs();
  const body = roster.length ? renderRoster(roster) : "(no roles currently in the interview/offer stage)";
  return (
    `Build a compensation comparison across every role I'm actively interviewing for (the roster below — one block per role, ` +
    `with whatever comp notes / recruiter emails / JD I already have). For each, also read \`interview-prep/<slug>/\` and ` +
    `research external comp/valuation (levels.fyi, funding news) to fill gaps — label estimates, NEVER invent numbers. Produce ONE ` +
    `markdown document (a table with columns Role | Base | Bonus | Equity | Company stage | Upside character, then a 3–5 sentence ` +
    `synthesis) and submit ONE record via submitJobResult(type:"peer-comp") shaped { markdown } per peer-comp.md.\n\n` +
    `Roles I'm actively interviewing for:\n\n${body}`
  );
}
