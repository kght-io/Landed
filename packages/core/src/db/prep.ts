import { eq, asc, desc } from "drizzle-orm";
import { db } from "./index";
import { prepQuestions, prepAttempts, prepProgress, prepCompany, prepFeedback } from "./schema";
import type { PrepQuestionRow, PrepAttemptRow, PrepCompanyRow, PrepFeedbackRow } from "./schema";
import { canonical, norm } from "@landed/shared/agents/canonical";
import { str, num } from "@landed/shared/coerce";
import type { ChangeDetail } from "@landed/shared/agents/types";
import { parseLeetcodeUrl } from "@landed/shared/prep/leetcode";

// ── Public shapes (JSON-parsed, derived stats folded in) ──

export type AttemptStatus = "solved" | "partial" | "failed";

export type PrepContent = {
  why?: string;
  note?: string;
  approach?: string[];
  followUps?: string[];
  gotchas?: string[];
  keyComponents?: string[];
  deepDive?: string[];
  monitoring?: string[];
  category?: string;
  tier?: number;
  pendingEnrich?: boolean; // manual leetcode add awaiting the leetcode-add job to fill difficulty/topic
};

export type PrepPlan = {
  day?: number;
  week?: number;
  pattern?: string;
  anchor?: boolean;
  extra?: boolean;
};

// Per-company framing for a shared question: which category it sits in for that company,
// its order within that category, an optional company-specific note, and — for the interview
// view — which round it belongs to, how confident we are it'll be asked, and where that
// confidence came from.
export type PrepConfidence = "confirmed" | "likely";
export type CompanyMetaEntry = {
  category?: string;
  sortOrder?: number;
  note?: string;
  round?: string; // round key (prepCompany.rounds[].key)
  confidence?: PrepConfidence; // confirmed = sourced/asked-before; likely = predicted
  source?: string; // where the intel came from (label or url), for confirmed questions
  reason?: string; // why confirmed (it was asked, by whom/when) or why likely (the prediction rationale)
};
export type CompanyMeta = Record<string, CompanyMetaEntry>;

export type PrepTrack = "coding" | "system_design" | "behavioral" | "other";

export type PrepQuestion = {
  id: string;
  track: PrepTrack;
  name: string;
  prompt?: string;
  difficulty?: string;
  priority?: string;
  url?: string;
  leetcodeNum?: number;
  tags: string[];
  companies: string[];
  companyMeta: CompanyMeta;
  content: PrepContent;
  plan?: PrepPlan;
  sortOrder?: number;
  // Set only when listQuestions is filtered to one company — the per-company framing
  // folded in from companyMeta[slug] so the view can group/order without re-parsing.
  companyCategory?: string;
  companyNote?: string;
  companyRound?: string; // round key this question belongs to (interview view)
  companyConfidence?: PrepConfidence;
  companySource?: string;
  companyConfidenceReason?: string; // why confirmed / likely (shown when the confidence tag is clicked)
  // derived progress
  timesDone: number;
  bestSec?: number;
  lastStatus?: AttemptStatus;
  lastAttemptAt?: string;
  lastAttemptId?: number;
  done: boolean;
  noted: boolean;
  redo: boolean;
};

export type PrepAttempt = {
  id: number;
  questionId: string;
  attemptedAt: string;
  durationSec?: number;
  status: AttemptStatus;
  notes?: string;
};

// ── Mappers ──

function parseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const toAttempt = (r: PrepAttemptRow): PrepAttempt => ({
  id: r.id,
  questionId: r.questionId,
  attemptedAt: r.attemptedAt,
  durationSec: r.durationSec ?? undefined,
  status: r.status as AttemptStatus,
  notes: r.notes ?? undefined,
});

type Stats = {
  timesDone: number;
  bestSec?: number;
  lastStatus?: AttemptStatus;
  lastAttemptAt?: string;
  lastAttemptId?: number;
  done: boolean;
};

function statsFor(attempts: PrepAttemptRow[]): Stats {
  if (attempts.length === 0) return { timesDone: 0, done: false };
  const durations = attempts.map((a) => a.durationSec).filter((d): d is number => d != null);
  // attempts come in ascending id; the last is the most recent.
  const last = attempts[attempts.length - 1];
  return {
    timesDone: attempts.length,
    bestSec: durations.length ? Math.min(...durations) : undefined,
    lastStatus: last.status as AttemptStatus,
    lastAttemptAt: last.attemptedAt,
    lastAttemptId: last.id,
    done: attempts.some((a) => a.status === "solved"),
  };
}

function toQuestion(
  r: PrepQuestionRow,
  stats: Stats,
  flags: { noted: boolean; redo: boolean },
  company?: string
): PrepQuestion {
  const companyMeta = parseJSON<CompanyMeta>(r.companyMeta, {});
  const lens = company ? companyMeta[company] : undefined;
  return {
    id: r.id,
    track: r.track as PrepTrack,
    name: r.name,
    prompt: r.prompt ?? undefined,
    difficulty: r.difficulty ?? undefined,
    priority: r.priority ?? undefined,
    url: r.url ?? undefined,
    leetcodeNum: r.leetcodeNum ?? undefined,
    tags: parseJSON<string[]>(r.tags, []),
    companies: parseJSON<string[]>(r.companies, []),
    companyMeta,
    content: parseJSON<PrepContent>(r.content, {}),
    plan: r.plan ? parseJSON<PrepPlan>(r.plan, {}) : undefined,
    sortOrder: r.sortOrder ?? undefined,
    companyCategory: lens?.category,
    companyNote: lens?.note,
    companyRound: lens?.round,
    companyConfidence: lens?.confidence,
    companySource: lens?.source,
    companyConfidenceReason: lens?.reason,
    ...stats,
    noted: flags.noted,
    redo: flags.redo,
  };
}

// ── Queries ──

// All questions for a track, optionally narrowed to one company lens, each joined
// with its derived attempt stats + progress flags. Generic views pass no company;
// company views pass a slug (matched against the `companies` JSON array).
export function listQuestions(opts: { track?: string; company?: string } = {}): PrepQuestion[] {
  let rows = db.select().from(prepQuestions).all();
  if (opts.track) rows = rows.filter((r) => r.track === opts.track);
  if (opts.company) {
    rows = rows.filter((r) => parseJSON<string[]>(r.companies, []).includes(opts.company!));
  }

  // Load attempts + progress once, bucket in memory (small table).
  const attempts = db.select().from(prepAttempts).orderBy(asc(prepAttempts.id)).all();
  const byQ = new Map<string, PrepAttemptRow[]>();
  for (const a of attempts) {
    const list = byQ.get(a.questionId) ?? [];
    list.push(a);
    byQ.set(a.questionId, list);
  }
  const progress = db.select().from(prepProgress).all();
  const flagsByQ = new Map(progress.map((p) => [p.questionId, { noted: p.noted, redo: p.redo }]));

  const out = rows.map((r) =>
    toQuestion(r, statsFor(byQ.get(r.id) ?? []), flagsByQ.get(r.id) ?? { noted: false, redo: false }, opts.company)
  );
  // Company lens orders by the per-company sortOrder (companyMeta); generic views use the
  // global sortOrder. Either way fall back to 0 so untagged rows sort stably.
  return opts.company
    ? out.sort((a, b) => (a.companyMeta[opts.company!]?.sortOrder ?? 0) - (b.companyMeta[opts.company!]?.sortOrder ?? 0))
    : out.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

// ── Company prep profiles (the agent research output) ──

// `key` links questions (companyMeta[slug].round) to a round. Optional so older profiles
// without keys still parse; the interview view falls back to index-based keys.
export type PrepRound = { key?: string; name: string; format?: string; focus?: string };
export type PrepCategory = {
  key: string;
  label: string;
  description?: string;
  kind: PrepTrack; // coding | system_design | behavioral | other — picks the card style
};
export type PrepSource = { label: string; url?: string };

export type CompanyProfile = {
  slug: string;
  name: string;
  overview?: string; // product/company summary
  process?: string;
  rounds: PrepRound[];
  categories: PrepCategory[];
  sources: PrepSource[];
  researchedAt?: string;
};

function toProfile(r: PrepCompanyRow): CompanyProfile {
  return {
    slug: r.slug,
    name: r.name,
    overview: r.overview ?? undefined,
    process: r.process ?? undefined,
    rounds: parseJSON<PrepRound[]>(r.rounds, []),
    categories: parseJSON<PrepCategory[]>(r.categories, []),
    sources: parseJSON<PrepSource[]>(r.sources, []),
    researchedAt: r.researchedAt ?? undefined,
  };
}

export function listCompanyProfiles(): CompanyProfile[] {
  return db
    .select()
    .from(prepCompany)
    .all()
    .map(toProfile)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getCompanyProfile(slug: string): CompanyProfile | null {
  const r = db.select().from(prepCompany).where(eq(prepCompany.slug, slug)).get();
  return r ? toProfile(r) : null;
}

export function listAttempts(questionId: string): PrepAttempt[] {
  return db
    .select()
    .from(prepAttempts)
    .where(eq(prepAttempts.questionId, questionId))
    .orderBy(desc(prepAttempts.id))
    .all()
    .map(toAttempt);
}

// Log one practice attempt and return it plus the question's refreshed derived stats.
export function logAttempt(input: {
  questionId: string;
  durationSec?: number;
  status?: AttemptStatus;
  notes?: string;
}): { attempt: PrepAttempt; stats: Stats } {
  const row = db
    .insert(prepAttempts)
    .values({
      questionId: input.questionId,
      attemptedAt: new Date().toISOString(),
      durationSec: input.durationSec ?? null,
      status: input.status ?? "solved",
      notes: input.notes?.trim() || null,
    })
    .returning()
    .get();
  const all = db
    .select()
    .from(prepAttempts)
    .where(eq(prepAttempts.questionId, input.questionId))
    .orderBy(asc(prepAttempts.id))
    .all();
  return { attempt: toAttempt(row), stats: statsFor(all) };
}

export function deleteAttempt(id: number): boolean {
  return db.delete(prepAttempts).where(eq(prepAttempts.id, id)).run().changes > 0;
}

// ── the agent prep handoff (ingest practice progress) ──
// The agent practices coding with You and writes a result file the app ingests, one
// record per question worked. Identity is resolved against the catalog by leetcodeNum
// first, then normalized name; an unrecognized question is inserted (track=coding) so
// the attempt has a home — see prep.md.

const PREP_STATUSES: AttemptStatus[] = ["solved", "partial", "failed"];
const asStatus = (v: unknown): AttemptStatus =>
  PREP_STATUSES.includes(v as AttemptStatus) ? (v as AttemptStatus) : "solved";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function resolveQuestionId(rec: Record<string, unknown>, catalog: PrepQuestionRow[]): string | null {
  const ln = num(rec.leetcodeNum);
  if (ln != null) {
    const m = catalog.find((q) => q.leetcodeNum === ln);
    if (m) return m.id;
  }
  const name = str(rec.name);
  if (name) {
    const n = norm(name);
    const m = catalog.find((q) => norm(q.name) === n);
    if (m) return m.id;
  }
  return null;
}

function newQuestionId(rec: Record<string, unknown>, taken: Set<string>): string {
  const ln = num(rec.leetcodeNum);
  const base = ln != null ? `lc-${ln}` : slug(str(rec.name) ?? "q") || "q";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

export type PrepIngestResult = {
  inserted: number; // new catalog questions
  attempts: number; // practice attempts logged
  flagged: number; // noted/redo flag updates
  details: ChangeDetail[];
};

// Ingest the agent's prep result records. dryRun computes the same outcome without writing
// (powers the preview). Matching + dedupe happen against an in-memory catalog snapshot so
// a new question referenced twice in one batch is inserted once.
export function ingestPrepRecords(records: Record<string, unknown>[], dryRun = false): PrepIngestResult {
  const catalog = db.select().from(prepQuestions).all();
  const taken = new Set(catalog.map((q) => q.id));
  let maxSort = catalog.reduce((m, q) => Math.max(m, q.sortOrder ?? 0), 0);

  let inserted = 0;
  let attempts = 0;
  let flagged = 0;
  const details: ChangeDetail[] = [];

  for (const rec of records) {
    let qid = resolveQuestionId(rec, catalog);
    let label: string;

    if (!qid) {
      const name = str(rec.name);
      if (!name) {
        details.push({ action: "skip", summary: "prep record with no catalog match and no name — skipped" });
        continue;
      }
      qid = newQuestionId(rec, taken);
      taken.add(qid);
      maxSort += 1;
      const row = {
        id: qid,
        track: "coding" as const,
        name,
        prompt: str(rec.prompt) ?? null,
        difficulty: str(rec.difficulty) ?? null,
        priority: str(rec.priority) ?? null,
        url: str(rec.url) ?? null,
        leetcodeNum: num(rec.leetcodeNum),
        tags: JSON.stringify(Array.isArray(rec.tags) ? rec.tags : []),
        companies: JSON.stringify([]),
        content: JSON.stringify(rec.content ?? {}),
        plan: null,
        sortOrder: maxSort,
      };
      if (!dryRun) db.insert(prepQuestions).values(row).run();
      catalog.push(row as PrepQuestionRow); // so later records in the batch resolve to it
      inserted++;
      label = name;
      details.push({ action: "insert", summary: `new coding Q — ${name}${rec.leetcodeNum ? ` (LC ${rec.leetcodeNum})` : ""}` });
    } else {
      label = catalog.find((q) => q.id === qid)?.name ?? qid;
    }

    const status = asStatus(rec.status);
    const durationSec = num(rec.durationSec);
    if (!dryRun) {
      db.insert(prepAttempts)
        .values({
          questionId: qid,
          attemptedAt: str(rec.attemptedAt) ?? new Date().toISOString(),
          durationSec,
          status,
          notes: str(rec.notes) ?? null,
        })
        .run();
    }
    attempts++;
    const dur = durationSec != null ? ` · ${Math.round(durationSec / 60)}m` : "";
    details.push({ action: "attempt", summary: `${label} · ${status}${dur}` });

    const noted = typeof rec.noted === "boolean" ? rec.noted : undefined;
    const redo = typeof rec.redo === "boolean" ? rec.redo : undefined;
    if (noted !== undefined || redo !== undefined) {
      if (!dryRun) setProgress(qid, { noted, redo });
      flagged++;
    }
  }

  return { inserted, attempts, flagged, details };
}

// ── Manual leetcode add (URL → stub, enriched later by the leetcode-add job) ──

export type LeetcodeStubResult =
  | { status: "exists"; question: PrepQuestion } // already in the bank — no dup, no job needed
  | { status: "invalid" } // not a parseable LeetCode problem URL
  | { status: "created"; question: PrepQuestion }; // inserted a stub → caller queues the enrich job

// Insert a provisional coding question from a LeetCode URL: the name is derived from the slug and
// difficulty/topic are left for the leetcode-add job to fill (content.pendingEnrich = true). An
// optional user-supplied topic is stored as the first tag (the tracker groups by it); left blank,
// the job infers it. Deduped against the shared bank by name, so re-adding an existing problem
// (e.g. one already in the curriculum) is a no-op rather than a duplicate.
export function addLeetcodeStub(input: { url: string; topic?: string }): LeetcodeStubResult {
  const parsed = parseLeetcodeUrl(input.url);
  if (!parsed) return { status: "invalid" };

  const catalog = db.select().from(prepQuestions).all();
  const existingId = resolveQuestionId({ name: parsed.name }, catalog);
  if (existingId) {
    const row = db.select().from(prepQuestions).where(eq(prepQuestions.id, existingId)).get()!;
    return { status: "exists", question: toQuestion(row, statsFor([]), { noted: false, redo: false }) };
  }

  const topic = str(input.topic);
  const taken = new Set(catalog.map((q) => q.id));
  const id = newQuestionId({ name: parsed.name }, taken);
  const maxSort = catalog.reduce((m, q) => Math.max(m, q.sortOrder ?? 0), 0);
  const row = {
    id,
    track: "coding" as const,
    name: parsed.name,
    prompt: null,
    difficulty: null,
    priority: null,
    url: input.url.trim(),
    leetcodeNum: null,
    tags: JSON.stringify(topic ? [topic] : []),
    companies: JSON.stringify([]),
    companyMeta: JSON.stringify({}),
    content: JSON.stringify({ pendingEnrich: true } satisfies PrepContent),
    plan: null,
    sortOrder: maxSort + 1,
  };
  db.insert(prepQuestions).values(row).run();
  return { status: "created", question: toQuestion(row as PrepQuestionRow, statsFor([]), { noted: false, redo: false }) };
}

export type LeetcodeAddResult = { enriched: number; details: ChangeDetail[] };

// Ingest for the leetcode-add job: the agent resolved a stub's real name/difficulty/topic (from the URL)
// and submits one record per question, keyed by the stub's `id`. We only FILL — set difficulty, the
// canonical name + leetcodeNum, the topic tag (unless the user already gave one), and clear the
// pending flag. Never creates or dedupes here (the stub already exists); an unknown id is skipped.
export function ingestLeetcodeAdd(records: Record<string, unknown>[], dryRun = false): LeetcodeAddResult {
  const details: ChangeDetail[] = [];
  let enriched = 0;
  for (const rec of records) {
    const id = str(rec.id);
    if (!id) { details.push({ action: "skip", summary: "leetcode-add — record with no id, skipped" }); continue; }
    const row = db.select().from(prepQuestions).where(eq(prepQuestions.id, id)).get();
    if (!row) { details.push({ action: "skip", summary: `leetcode-add — no stub for "${id}", skipped` }); continue; }

    const name = str(rec.name) ?? row.name;
    const difficulty = str(rec.difficulty) ?? row.difficulty;
    const topic = str(rec.topic) ?? str(rec.pattern);
    const existingTags = parseJSON<string[]>(row.tags, []);
    // Keep the user's topic if they gave one; otherwise adopt the inferred topic as the first tag.
    const tags = existingTags.length ? existingTags : topic ? [topic] : existingTags;
    const content = parseJSON<PrepContent>(row.content, {});
    delete content.pendingEnrich;

    if (!dryRun) {
      db.update(prepQuestions)
        .set({
          name,
          difficulty: difficulty ?? null,
          leetcodeNum: num(rec.leetcodeNum) ?? row.leetcodeNum,
          tags: JSON.stringify(tags),
          content: JSON.stringify(content),
        })
        .where(eq(prepQuestions.id, id))
        .run();
    }
    enriched++;
    details.push({ action: "update", summary: `leetcode — ${name}${difficulty ? ` · ${difficulty}` : ""}${tags[0] ? ` · ${tags[0]}` : ""}` });
  }
  return { enriched, details };
}

// Upsert per-question flags (noted / redo). Returns the resulting flag pair.
export function setProgress(
  questionId: string,
  patch: { noted?: boolean; redo?: boolean }
): { questionId: string; noted: boolean; redo: boolean } {
  const existing = db
    .select()
    .from(prepProgress)
    .where(eq(prepProgress.questionId, questionId))
    .get();
  const noted = patch.noted ?? existing?.noted ?? false;
  const redo = patch.redo ?? existing?.redo ?? false;
  const now = new Date().toISOString();
  const redoAddedAt = patch.redo === true ? now : patch.redo === false ? null : existing?.redoAddedAt ?? null;

  if (existing) {
    db.update(prepProgress)
      .set({ noted, redo, redoAddedAt, updatedAt: now })
      .where(eq(prepProgress.questionId, questionId))
      .run();
  } else {
    db.insert(prepProgress).values({ questionId, noted, redo, redoAddedAt, updatedAt: now }).run();
  }
  return { questionId, noted, redo };
}

// ── the agent prep-research handoff (per-company interview prep) ──
// The agent researches a company's interview process and submits one batch: a single profile
// record ({ type:"profile", ... }) plus N question records ({ type:"question", category, ... }).
// Questions reuse the shared bank — a coding/system_design record that matches an existing
// catalog question by leetcodeNum (or name) is TAGGED onto the company (companies += slug,
// companyMeta[slug] set) rather than duplicated, so its attempt history carries over. Bespoke
// (behavioral/other) questions are inserted. The profile drives the company view's sections.

// Canonical company key, shared with prepQuestions.companies / companyMeta. Falls back to a
// plain slug when the name doesn't canonicalize (keeps an oddly-named company addressable).
export const companySlug = (name: string): string => canonical(name)?.key ?? slug(name);

const TRACKS: PrepTrack[] = ["coding", "system_design", "behavioral", "other"];
const asTrack = (rec: Record<string, unknown>): PrepTrack => {
  const t = str(rec.track);
  if (t && TRACKS.includes(t as PrepTrack)) return t as PrepTrack;
  return num(rec.leetcodeNum) != null ? "coding" : "other"; // LC# ⇒ coding; else bespoke
};

export type PrepResearchResult = {
  profile: number; // profiles upserted (0 or 1)
  reused: number; // existing questions tagged onto the company
  inserted: number; // new bespoke questions
  details: ChangeDetail[];
};

export function ingestPrepResearch(
  records: Record<string, unknown>[],
  dryRun = false
): PrepResearchResult {
  const profileRec = records.find((r) => str(r.type) === "profile");
  const questionRecs = records.filter((r) => str(r.type) !== "profile");

  const details: ChangeDetail[] = [];
  let profile = 0;
  let reused = 0;
  let inserted = 0;

  // Resolve the company slug from the profile (preferred) or the first question record.
  const companyName = str(profileRec?.company) ?? str(questionRecs[0]?.company);
  if (!companyName) {
    return { profile: 0, reused: 0, inserted: 0, details: [{ action: "skip", summary: "prep-research: no company — skipped" }] };
  }
  const cslug = str(profileRec?.slug) ?? companySlug(companyName);

  // ── upsert the profile ──
  if (profileRec) {
    const row = {
      slug: cslug,
      name: companyName,
      overview: str(profileRec.overview) ?? null,
      process: str(profileRec.process) ?? null,
      rounds: JSON.stringify(Array.isArray(profileRec.rounds) ? profileRec.rounds : []),
      categories: JSON.stringify(Array.isArray(profileRec.categories) ? profileRec.categories : []),
      sources: JSON.stringify(Array.isArray(profileRec.sources) ? profileRec.sources : []),
      researchedAt: str(profileRec.researchedAt) ?? new Date().toISOString(),
    };
    if (!dryRun) {
      db.insert(prepCompany)
        .values(row)
        .onConflictDoUpdate({ target: prepCompany.slug, set: row })
        .run();
    }
    profile = 1;
    const nCat = Array.isArray(profileRec.categories) ? profileRec.categories.length : 0;
    details.push({ action: "update", summary: `profile — ${companyName} (${nCat} categor${nCat === 1 ? "y" : "ies"})` });
    // Close the feedback loop: any queued feedback for this company is now addressed.
    if (!dryRun) {
      const applied = markFeedbackApplied(cslug);
      if (applied) details.push({ action: "update", summary: `${applied} feedback item${applied === 1 ? "" : "s"} marked applied` });
    }
  }

  // ── upsert the questions ──
  const catalog = db.select().from(prepQuestions).all();
  const taken = new Set(catalog.map((q) => q.id));
  let maxSort = catalog.reduce((m, q) => Math.max(m, q.sortOrder ?? 0), 0);

  questionRecs.forEach((rec, i) => {
    const confidence = str(rec.confidence);
    const meta: CompanyMetaEntry = {
      category: str(rec.category) ?? undefined,
      sortOrder: num(rec.sortOrder) ?? i + 1,
      note: str(rec.note) ?? undefined,
      round: str(rec.round) ?? undefined,
      confidence: confidence === "confirmed" || confidence === "likely" ? confidence : undefined,
      source: str(rec.source) ?? undefined,
      reason: str(rec.reason) ?? undefined,
    };

    // Resolve to the shared bank first — a reuse record (e.g. just a leetcodeNum) needs no name.
    const existingId = resolveQuestionId(rec, catalog);
    if (existingId) {
      // reuse: tag the existing question onto this company, preserving its attempt history.
      const row = catalog.find((q) => q.id === existingId)!;
      const companies = parseJSON<string[]>(row.companies, []);
      const companyMeta = parseJSON<CompanyMeta>(row.companyMeta, {});
      if (!companies.includes(cslug)) companies.push(cslug);
      companyMeta[cslug] = meta;
      if (!dryRun) {
        db.update(prepQuestions)
          .set({ companies: JSON.stringify(companies), companyMeta: JSON.stringify(companyMeta) })
          .where(eq(prepQuestions.id, existingId))
          .run();
      }
      row.companies = JSON.stringify(companies); // keep snapshot consistent for the batch
      row.companyMeta = JSON.stringify(companyMeta);
      reused++;
      details.push({ action: "update", summary: `reuse — ${row.name} → ${companyName}/${meta.category ?? "?"}` });
      return;
    }

    // new bespoke question (or unmatched LC) — insert, tagged to this company. Needs a name.
    const name = str(rec.name);
    if (!name) {
      details.push({ action: "skip", summary: "prep-research question — no catalog match and no name, skipped" });
      return;
    }
    const qid = newQuestionId(rec, taken);
    taken.add(qid);
    maxSort += 1;
    const row: PrepQuestionRow = {
      id: qid,
      track: asTrack(rec),
      name,
      prompt: str(rec.prompt) ?? null,
      difficulty: str(rec.difficulty) ?? null,
      priority: str(rec.priority) ?? null,
      url: str(rec.url) ?? null,
      leetcodeNum: num(rec.leetcodeNum),
      tags: JSON.stringify(Array.isArray(rec.tags) ? rec.tags : []),
      companies: JSON.stringify([cslug]),
      companyMeta: JSON.stringify({ [cslug]: meta }),
      content: JSON.stringify(rec.content ?? {}),
      plan: null,
      sortOrder: maxSort,
    };
    if (!dryRun) db.insert(prepQuestions).values(row).run();
    catalog.push(row);
    inserted++;
    details.push({ action: "insert", summary: `new ${row.track} Q — ${name} (${companyName}/${meta.category ?? "?"})` });
  });

  return { profile, reused, inserted, details };
}

// ── Prep feedback (per-company / per-round refinement requests) ──
// You leave feedback on a company's prep (optionally scoped to one round); it's appended to a
// thread and dispatched to the agent as a prep-research refinement job. The agent re-researches and,
// on re-ingest, the queued feedback for that company is marked applied (see markFeedbackApplied).

export type PrepFeedback = {
  id: number;
  slug: string;
  round?: string;
  text: string;
  status: "queued" | "applied";
  jobId?: string;
  createdAt: string;
  appliedAt?: string;
};

const toFeedback = (r: PrepFeedbackRow): PrepFeedback => ({
  id: r.id,
  slug: r.slug,
  round: r.round ?? undefined,
  text: r.text,
  status: r.status as "queued" | "applied",
  jobId: r.jobId ?? undefined,
  createdAt: r.createdAt,
  appliedAt: r.appliedAt ?? undefined,
});

// All feedback for a company, newest first.
export function listFeedback(slug: string): PrepFeedback[] {
  return db
    .select()
    .from(prepFeedback)
    .where(eq(prepFeedback.slug, slug))
    .orderBy(desc(prepFeedback.id))
    .all()
    .map(toFeedback);
}

// Append a feedback entry. `jobId` is the prep-research job it dispatched (set by the API route).
export function addFeedback(input: { slug: string; round?: string; text: string; jobId?: string }): PrepFeedback {
  const row = db
    .insert(prepFeedback)
    .values({
      slug: input.slug,
      round: input.round ?? null,
      text: input.text.trim(),
      status: "queued",
      jobId: input.jobId ?? null,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();
  return toFeedback(row);
}

export function deleteFeedback(id: number): boolean {
  return db.delete(prepFeedback).where(eq(prepFeedback.id, id)).run().changes > 0;
}

// Mark a company's queued feedback as applied — called from ingestPrepResearch after the agent's
// refresh lands so the UI can show the loop closing. Returns the count flipped.
export function markFeedbackApplied(slug: string): number {
  return db
    .update(prepFeedback)
    .set({ status: "applied", appliedAt: new Date().toISOString() })
    .where(eq(prepFeedback.slug, slug))
    .run().changes;
}
