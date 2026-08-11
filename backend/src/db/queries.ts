import { eq, desc, and, inArray, like, or } from "drizzle-orm";
import { db } from "./index";
import { companies, events, interviews, pendingMatches, postings } from "./schema";
import type { PostingRow, CompanyRow, EventRow } from "./schema";
import { canonical, defaultTier, norm } from "@landed/shared/agents/canonical";
import { emitStageChange } from "./stage-change";
import { logEvent, by } from "./events";
import { applyRejectionCooldown, coolingCompanyIds, isCompanyCooling, setCompanyCooldown } from "./cooldown";
import { isHiddenWhileCooling } from "@landed/shared/pipeline/cooldown";
import { parseRedoLog } from "@landed/shared/jobs/redolog";
import { parseBriefs } from "@landed/shared/jobs/briefs";
import { isExcludedTitle } from "@landed/shared/jobs/exclude";
import type { Leveling } from "@landed/shared/config/leveling";
import { describeChanges, type DescribedChange, type FieldDiff } from "@landed/shared/format/change";
import type { Comment, EmailRefs, FitAssessment, InterviewKind, Interviewer, InterviewRound, Posting, RedoTurn, Status, Tier } from "@landed/shared/types";
import type { InterviewRow } from "./schema";
import type { IncomingApp } from "@landed/shared/agents/types";
import { TRACKER_STAGES } from "@landed/shared/pipeline/stages";

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString(); // full ISO — for company audit timestamps

// Parse a JSON column that holds an array, tolerating null/garbage (agent-written data).
export function jsonArray<T>(raw: string | null): T[] | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length ? (v as T[]) : undefined;
  } catch {
    return undefined;
  }
}

// A stored interview row → the view model. Rounds sort by `round`, then date.
function toRound(r: InterviewRow): InterviewRound {
  return {
    id: r.id,
    round: r.round ?? undefined,
    stage: r.stage ?? undefined,
    kind: (r.kind as InterviewKind | null) ?? undefined,
    date: r.date ?? undefined,
    outcome: (r.outcome as InterviewRound["outcome"] | null) ?? undefined,
    notes: r.notes ?? undefined,
    emailId: r.emailId ?? undefined,
    startTime: r.startTime ?? undefined,
    durationMins: r.durationMins ?? undefined,
    timezone: r.timezone ?? undefined,
    interviewers: jsonArray<Interviewer>(r.interviewers),
    format: r.format ?? undefined,
    joinUrl: r.joinUrl ?? undefined,
    whatToExpect: r.whatToExpect ?? undefined,
    prepNotes: jsonArray<string>(r.prepNotes),
    attachments: jsonArray<string>(r.attachments),
  };
}
const roundSort = (a: InterviewRound, b: InterviewRound) =>
  (a.round ?? 0) - (b.round ?? 0) || (a.date ?? "").localeCompare(b.date ?? "");

// fit_detail is a JSON FitAssessment blob; tolerate bad/empty data.
function parseFit(raw: string | null): FitAssessment | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as FitAssessment) : undefined;
  } catch {
    return undefined;
  }
}

// Map a unified posting row (a `postings` row in a tracker stage) → the Posting view.
// `rounds` are the posting's interview rows (already mapped + sorted); omitted = none.
function toPosting(a: PostingRow, c: CompanyRow, rounds?: InterviewRound[]): Posting {
  return {
    id: String(a.id),
    company: c.name,
    tier: c.tier as Tier,
    watchlist: !!c.watchlist,
    cooldownUntil: c.cooldownUntil,
    role: a.title ?? "—",
    location: a.location ?? undefined,
    url: a.url ?? undefined,
    source: a.source ?? undefined,
    fitScore: a.fitScore ?? undefined,
    fit: parseFit(a.fitDetail),
    status: a.state as Status,
    channel: (a.channel as "direct" | "referral" | null) ?? undefined,
    interviewed: a.interviewed,
    needsReview: a.needsReview,
    pinned: a.pinned,
    resumeDir: a.resumeDir ?? undefined,
    chosenResume: a.chosenResume ?? null,
    editedResumes: parseStrArray(a.editedResumes),
    emailRefs: parseEmailRefs(a.emailRefs),
    redoLog: parseRedoLog(a.redoLog),
    interviewBriefs: parseBriefs(a.interviewBriefs).length ? parseBriefs(a.interviewBriefs) : undefined,
    leveling: parseLeveling(c.leveling),
    note: a.note ?? undefined,
    comp: a.comp ?? undefined,
    teamNotes: a.teamNotes ?? undefined,
    comments: parseComments(a.comments),
    history: a.historical,
    discoveredAt: a.discoveredAt ?? undefined,
    appliedDate: a.appliedDate ?? undefined,
    updatedAt: a.updatedAt ?? undefined,
    interviews: rounds?.length ? rounds : undefined,
  };
}

// All interview rounds for a posting, ordered.
export function listInterviews(appId: number): InterviewRound[] {
  return db.select().from(interviews).where(eq(interviews.applicationId, appId)).all().map(toRound).sort(roundSort);
}

// Idempotently merge incoming rounds into the `interviews` table for one posting. Matches an
// existing row by `round` number; updates only changed fields, inserts new rounds. Re-syncing the
// same rounds is a no-op. Returns the number of rows inserted or updated.
// `dryRun` counts what WOULD change without writing — how the approval flow previews "adds 2 rounds"
// on a change card before you approve it (same comparison, so the preview can't drift from the write).
export function upsertInterviews(appId: number, rounds: InterviewRound[], opts: { dryRun?: boolean } = {}): number {
  if (!rounds.length) return 0;
  const existing = db.select().from(interviews).where(eq(interviews.applicationId, appId)).all();
  const maxRound = existing.reduce((m, r) => Math.max(m, r.round ?? 0), 0);
  let changed = 0;
  let next = maxRound;
  for (const inc of rounds) {
    const roundNo = inc.round ?? ++next;
    const prior = existing.find((r) => (r.round ?? 0) === roundNo);
    // `inc.X ?? prior.X` throughout: a writer only states what it knows, so an omitted field keeps
    // what's stored. That's the whole merge contract between the two writers — inbox-sync reports
    // kind/date/outcome from a cheap global pass, interview-emails reports the round's substance
    // from a deep per-company read, and neither erases the other by staying silent.
    const list = (v: unknown[] | undefined, p: string | null) => (v?.length ? JSON.stringify(v) : p ?? null);
    const vals = {
      round: roundNo,
      stage: inc.stage ?? prior?.stage ?? null,
      kind: inc.kind ?? prior?.kind ?? null,
      date: inc.date ?? prior?.date ?? null,
      outcome: inc.outcome ?? prior?.outcome ?? null,
      notes: inc.notes ?? prior?.notes ?? null,
      emailId: inc.emailId ?? prior?.emailId ?? null,
      startTime: inc.startTime ?? prior?.startTime ?? null,
      durationMins: inc.durationMins ?? prior?.durationMins ?? null,
      timezone: inc.timezone ?? prior?.timezone ?? null,
      interviewers: list(inc.interviewers, prior?.interviewers ?? null),
      format: inc.format ?? prior?.format ?? null,
      joinUrl: inc.joinUrl ?? prior?.joinUrl ?? null,
      whatToExpect: inc.whatToExpect ?? prior?.whatToExpect ?? null,
      prepNotes: list(inc.prepNotes, prior?.prepNotes ?? null),
      attachments: list(inc.attachments, prior?.attachments ?? null),
    };
    if (prior) {
      // Update only when something actually differs (keeps re-sync a true no-op).
      const differs = (Object.keys(vals) as (keyof typeof vals)[]).some((k) => prior[k] !== vals[k]);
      if (differs) {
        if (!opts.dryRun) db.update(interviews).set(vals).where(eq(interviews.id, prior.id)).run();
        changed++;
      }
    } else {
      if (!opts.dryRun) db.insert(interviews).values({ applicationId: appId, ...vals }).run();
      changed++;
    }
  }
  return changed;
}

// Add one hand-authored interview round to a posting. Appended after the highest existing round
// number so it sorts last; inbox-sync (upsertInterviews) keeps matching on `round`, so synced and
// hand-authored rounds coexist. `notes` doubles as the format/focus the recruiter described (fed to
// prep-research). Returns the updated Posting, or null if the posting is gone.
export function addInterviewRound(
  appId: number,
  round: Pick<InterviewRound, "kind" | "date" | "outcome" | "notes">,
): Posting | null {
  const raw = db.select().from(postings).where(eq(postings.id, appId)).get();
  if (!raw) return null;
  const maxRound = db
    .select()
    .from(interviews)
    .where(eq(interviews.applicationId, appId))
    .all()
    .reduce((m, r) => Math.max(m, r.round ?? 0), 0);
  db.insert(interviews)
    .values({
      applicationId: appId,
      round: maxRound + 1,
      kind: round.kind ?? null,
      date: round.date ?? null,
      outcome: round.outcome ?? null,
      notes: round.notes ?? null,
    })
    .run();
  return getPosting(appId);
}

// Edit one interview round by its row id. Only the provided fields change. Returns the updated
// Posting (resolved from the round's posting), or null if the round is gone.
export function updateInterviewRound(
  roundId: number,
  patch: Partial<Pick<InterviewRound, "kind" | "date" | "outcome" | "notes">>,
): Posting | null {
  const row = db.select().from(interviews).where(eq(interviews.id, roundId)).get();
  if (!row) return null;
  const set: Record<string, unknown> = {};
  if ("kind" in patch) set.kind = patch.kind ?? null;
  if ("date" in patch) set.date = patch.date ?? null;
  if ("outcome" in patch) set.outcome = patch.outcome ?? null;
  if ("notes" in patch) set.notes = patch.notes ?? null;
  if (Object.keys(set).length) db.update(interviews).set(set).where(eq(interviews.id, roundId)).run();
  return getPosting(row.applicationId);
}

// Delete one interview round by its row id. Returns the updated Posting, or null if it was gone.
export function deleteInterviewRound(roundId: number): Posting | null {
  const row = db.select().from(interviews).where(eq(interviews.id, roundId)).get();
  if (!row) return null;
  db.delete(interviews).where(eq(interviews.id, roundId)).run();
  return getPosting(row.applicationId);
}

// --- change log ---
// logEvent + `by` live in ./events (a leaf), so cooldown.ts and friends can append audit rows
// without importing this module. Re-exported because callers have always read them from here.
export { logEvent, by };

// The tracker: postings in a tracker stage (applied onward). Discovery-stage rows stay in the funnel.
export function listPostings(): Posting[] {
  const rows = db
    .select()
    .from(postings)
    .innerJoin(companies, eq(postings.companyId, companies.id))
    .where(inArray(postings.state, [...TRACKER_STAGES]))
    .all();
  // Batch-load interview rounds for all tracker postings in one query, grouped by posting.
  const ids = rows.map((r) => r.postings.id);
  const byApp = new Map<number, InterviewRound[]>();
  if (ids.length) {
    for (const row of db.select().from(interviews).where(inArray(interviews.applicationId, ids)).all()) {
      const list = byApp.get(row.applicationId) ?? [];
      list.push(toRound(row));
      byApp.set(row.applicationId, list);
    }
    for (const list of byApp.values()) list.sort(roundSort);
  }
  return rows.map((r) => toPosting(r.postings, r.companies, byApp.get(r.postings.id)));
}

export function getPosting(id: number): Posting | null {
  const r = db
    .select()
    .from(postings)
    .innerJoin(companies, eq(postings.companyId, companies.id))
    .where(eq(postings.id, id))
    .get();
  return r ? toPosting(r.postings, r.companies, listInterviews(id)) : null;
}

// Hard-delete one application and its interview rows (FK children). Logged as a
// row-level delete event so the change log keeps a tombstone of what was removed.
// Append a personal comment to a posting (any stage). Returns the updated Posting. Comments are
// your private thread — deliberately NOT logged to the change feed (they're not pipeline state).
export function addComment(id: number, text: string): Posting | null {
  const t = text.trim();
  const raw = db.select().from(postings).where(eq(postings.id, id)).get();
  if (!raw || !t) return null;
  const list = parseComments(raw.comments);
  list.push({ text: t, at: new Date().toISOString() });
  db.update(postings).set({ comments: JSON.stringify(list) }).where(eq(postings.id, id)).run();
  return getPosting(id);
}

// Persist a posting's JD (the agent's savePostingJd tool, called at the fit stage with the JD it
// fetched). A dedicated write — NOT echoed through submitJobResult — so fit + tailoring reuse it
// without re-fetching from the URL. Idempotent; only writes when the JD is non-empty.
export function setPostingJd(id: number, jd: string): Posting | null {
  const t = jd.trim();
  const raw = db.select().from(postings).where(eq(postings.id, id)).get();
  if (!raw || !t) return null;
  db.update(postings).set({ jd: t }).where(eq(postings.id, id)).run();
  logEvent({ entity: "company", entityId: raw.companyId, action: "update", source: "fit", actor: "CoWork", summary: `${raw.title} · JD saved (${t.length} chars)` });
  return getPosting(id);
}

// The stored JD for one posting (lazily loaded by the fit detail modal — kept off list payloads
// since it's large). Null when none has been saved yet.
export function getPostingJd(id: number): string | null {
  const r = db.select({ jd: postings.jd }).from(postings).where(eq(postings.id, id)).get();
  return r?.jd ?? null;
}

// Replace the text of the comment at `index`. Out-of-range or empty text → no-op.
export function editComment(id: number, index: number, text: string): Posting | null {
  const t = text.trim();
  const raw = db.select().from(postings).where(eq(postings.id, id)).get();
  if (!raw || !t) return null;
  const list = parseComments(raw.comments);
  if (index < 0 || index >= list.length) return getPosting(id);
  list[index] = { ...list[index], text: t, editedAt: new Date().toISOString() };
  db.update(postings).set({ comments: JSON.stringify(list) }).where(eq(postings.id, id)).run();
  return getPosting(id);
}

// Delete the comment at `index` from a posting's thread. Out-of-range → no-op.
export function deleteComment(id: number, index: number): Posting | null {
  const raw = db.select().from(postings).where(eq(postings.id, id)).get();
  if (!raw) return null;
  const list = parseComments(raw.comments);
  if (index < 0 || index >= list.length) return getPosting(id);
  list.splice(index, 1);
  db.update(postings).set({ comments: JSON.stringify(list) }).where(eq(postings.id, id)).run();
  return getPosting(id);
}

export function deleteApplication(id: number, actor?: string): Posting | null {
  const before = getPosting(id);
  if (!before) return null;
  db.delete(interviews).where(eq(interviews.applicationId, id)).run();
  db.delete(postings).where(eq(postings.id, id)).run();
  logEvent({
    entity: "application", entityId: id, action: "delete", ...by(actor),
    summary: `${before.company} — ${before.role ?? "—"} · deleted`,
  });
  return before;
}

// External patch shape (tracker field names). Translated to the posting columns below
// (status→state, role→title) since the tracker now lives in the unified `postings` table.
export type ApplicationPatch = Partial<{
  status: Status; role: string; url: string | null; location: string | null;
  fitScore: number | null; fitDetail: string | null; resumeDir: string | null;
  appliedDate: string | null; channel: "direct" | "referral" | null; note: string | null; interviewed: boolean;
  pinned: boolean; chosenResume: string | null; editedResumes: string[];
  comp: string | null; teamNotes: string | null;
  updatedAt: string | null; // manually settable (e.g. the rejected/closed date) — overrides the auto-stamp
}>;
const PATCH_COL: Record<string, string> = { status: "state", role: "title" };
const patchCol = (k: string) => PATCH_COL[k] ?? k;

export function updateApplication(id: number, patch: ApplicationPatch, actor?: string): Posting | null {
  const before = getPosting(id);
  const rawBefore = db.select().from(postings).where(eq(postings.id, id)).get();
  if (!before || !rawBefore) return null;
  const set: Record<string, unknown> = { updatedAt: today() };
  // editedResumes is a JSON string[] column — serialize the array before writing.
  for (const [k, v] of Object.entries(patch)) set[patchCol(k)] = k === "editedResumes" && Array.isArray(v) ? JSON.stringify(v) : v;
  db.update(postings).set(set as Partial<typeof postings.$inferInsert>).where(eq(postings.id, id)).run();
  const after = getPosting(id);

  // Announce the stage move; the jobs layer decides what it's worth (entering `interview` earns a
  // one-shot prep-research job). This file deliberately doesn't know that — see ./stage-change.ts.
  if (patch.status) emitStageChange({ companyId: rawBefore.companyId, from: rawBefore.state, to: patch.status });

  // A rejection may have just earned this company a cooldown (or extended one). Recomputed from the
  // company's postings rather than from this patch, so it sees the interview rounds that decide
  // whether the rejection came after a real loop — and so a backdated `updatedAt` backdates it too.
  if (patch.status === "rejected") applyRejectionCooldown(rawBefore.companyId, id);

  // One event per changed field, capturing field + old → new so the change log is auditable.
  const fmt = (v: unknown) => (v == null || v === "" ? undefined : String(v));
  const raw = rawBefore as Record<string, unknown>;
  for (const key of Object.keys(patch) as (keyof ApplicationPatch)[]) {
    if (key === "pinned" || key === "editedResumes" || key === "updatedAt") continue; // UI prefs / metadata timestamp — not auditable field changes
    const oldValue = fmt(raw[patchCol(key)]);
    const newValue = fmt(patch[key]);
    if (oldValue === newValue) continue;
    logEvent({
      entityId: id, action: "update", field: key, oldValue, newValue, ...by(actor),
      summary: `${before.company} — ${before.role} · ${key} ${oldValue ?? "∅"} → ${newValue ?? "∅"}`,
    });
  }
  return after;
}

// Rename the company an application belongs to (affects every posting under it).
export function setCompanyName(id: number, name: string, actor?: string): Posting | null {
  const trimmed = name.trim();
  const app = db.select().from(postings).where(eq(postings.id, id)).get();
  if (!app) return null;
  const co = db.select().from(companies).where(eq(companies.id, app.companyId)).get();
  if (co && trimmed && co.name !== trimmed) {
    db.update(companies).set({ name: trimmed, updatedAt: now() }).where(eq(companies.id, app.companyId)).run();
    logEvent({
      entity: "company", entityId: co.id, action: "update", field: "name", ...by(actor),
      oldValue: co.name, newValue: trimmed, summary: `${co.name} → ${trimmed} · renamed`,
    });
  }
  return getPosting(id);
}

// Reassign ONE application to a different company (job-level edit → move it under the
// right company). Matches an existing company by canonical name, else creates one.
// If the typed name canonicalizes to the SAME company, it's treated as a typo rename.
export function moveApplicationToCompany(id: number, name: string, actor?: string): Posting | null {
  const trimmed = name.trim();
  const app = db.select().from(postings).where(eq(postings.id, id)).get();
  if (!app || !trimmed) return null;
  const c = canonical(trimmed);
  if (!c) return null;

  const all = db.select().from(companies).all();
  const oldCo = all.find((x) => x.id === app.companyId);
  let target = all.find((x) => canonical(x.name)?.key === c.key);

  // Same company → it's just a name fix; reuse the company-rename path.
  if (target && target.id === app.companyId) return setCompanyName(id, trimmed, actor);

  if (!target) {
    const tier = defaultTier(c.key);
    const ts = now();
    const newId = db.insert(companies).values({ name: trimmed, tier, createdAt: ts, updatedAt: ts }).returning({ id: companies.id }).get().id;
    logEvent({ entity: "company", entityId: newId, action: "insert", ...by(actor), summary: `new company ${trimmed} [${tier}]` });
    target = { id: newId, name: trimmed, tier, careersUrl: null, ats: null, notes: null, createdAt: ts, updatedAt: ts } as CompanyRow;
  }

  db.update(postings).set({ companyId: target.id, updatedAt: today() }).where(eq(postings.id, id)).run();
  logEvent({
    entityId: id, action: "update", field: "company", ...by(actor),
    oldValue: oldCo?.name, newValue: target.name,
    summary: `${app.title ?? "?"} · moved ${oldCo?.name ?? "?"} → ${target.name}`,
  });
  return getPosting(id);
}

export function setTierForApplication(id: number, tier: Tier, actor?: string): Posting | null {
  const app = db.select().from(postings).where(eq(postings.id, id)).get();
  if (!app) return null;
  const co = db.select().from(companies).where(eq(companies.id, app.companyId)).get();
  if (co && co.tier !== tier) {
    db.update(companies).set({ tier, updatedAt: now() }).where(eq(companies.id, app.companyId)).run();
    logEvent({
      entity: "company", entityId: co.id, action: "update", field: "tier", ...by(actor),
      oldValue: co.tier, newValue: tier, summary: `${co.name} · tier ${co.tier} → ${tier}`,
    });
  }
  return getPosting(id);
}

// --- companies / watchlist ---
// Output shape for a company: scrape config + criteria, with target_titles parsed to an
// array and target_location surfaced as `location`. Used by /api/companies + /api/watchlist.
export type CompanyView = Omit<CompanyRow, "targetTitles" | "targetLocation"> & {
  titles: string[] | null;
  location: string | null;
};
export function toCompanyView(c: CompanyRow): CompanyView {
  let titles: string[] | null = null;
  if (c.targetTitles) {
    try {
      titles = JSON.parse(c.targetTitles) as string[];
    } catch {
      titles = null;
    }
  }
  const { targetTitles: _t, targetLocation, ...rest } = c;
  return { ...rest, titles, location: targetLocation };
}

// Every company you track (the full universe), for visibility + curation. Newest-ish first.
export function listCompanies(): CompanyView[] {
  return db.select().from(companies).all().map(toCompanyView);
}

// Just the discovery watchlist (companies the agent auto-scans). Independent of tier.
export function listWatchlist(): CompanyView[] {
  return db.select().from(companies).where(eq(companies.watchlist, true)).all().map(toCompanyView);
}

// --- company records (curation: tier + scrape config) ---
// NOTE: watchlist membership is NOT set here — it's a separate concern, managed via
// setWatchlist / the /api/watchlist resource. This keeps "edit a company" and "manage the
// scan list" cleanly apart.
export type CompanyInput = {
  name: string;
  tier?: Tier;
  ats?: string | null;
  fetchMethod?: string | null; // api | careers-get | browser — how the agent reads the board
  fetchRecipe?: string | null; // scan steps for browser/careers-get boards (filters, excludes, level source)
  slug?: string | null;
  endpoint?: string | null;
  careersUrl?: string | null;
  titles?: string[] | null; // → target_titles (JSON)
  location?: string | null; // → target_location
  leveling?: Leveling | null; // → leveling (JSON): the company's levels.fyi ladder, Amazon-anchored
  notes?: string | null;
  lastScrapedAt?: string | null; // ISO; usually auto-stamped on discovery, but settable here too
  cooldownUntil?: string | null; // YYYY-MM-DD; discovery skips this company until then. null clears it.
};

// Upsert company records — The agent curates these as you chat. Matched by canonical name: an
// existing company is patched (only the provided fields change); an unknown one is inserted.
// Never renames an existing company, never touches its watchlist flag. Returns rows + counts.
export function upsertCompanies(
  inputs: CompanyInput[],
  meta: { actor?: string; source?: string } = {}
): { upserted: CompanyRow[]; inserted: number; updated: number } {
  const all = db.select().from(companies).all();
  const out: CompanyRow[] = [];
  let inserted = 0;
  let updated = 0;

  for (const t of inputs) {
    const c = canonical(t.name);
    if (!c) continue; // junk / unnamed → skip

    // Patch only the fields the caller actually provided.
    const patch: Partial<typeof companies.$inferInsert> = {};
    if (t.tier !== undefined) patch.tier = t.tier;
    if (t.ats !== undefined) patch.ats = t.ats;
    if (t.fetchMethod !== undefined) patch.fetchMethod = t.fetchMethod;
    if (t.fetchRecipe !== undefined) patch.fetchRecipe = t.fetchRecipe;
    if (t.slug !== undefined) patch.slug = t.slug;
    if (t.endpoint !== undefined) patch.endpoint = t.endpoint;
    if (t.careersUrl !== undefined) patch.careersUrl = t.careersUrl;
    if (t.notes !== undefined) patch.notes = t.notes;
    if (t.titles !== undefined) patch.targetTitles = t.titles ? JSON.stringify(t.titles) : null;
    if (t.location !== undefined) patch.targetLocation = t.location;
    if (t.leveling !== undefined) patch.leveling = t.leveling ? JSON.stringify(t.leveling) : null;
    if (t.lastScrapedAt !== undefined) patch.lastScrapedAt = t.lastScrapedAt;
    // cooldownUntil is deliberately NOT patched here — it's written after the upsert, through
    // setCompanyCooldown, so a hand-set date goes through the same validation and lands the same
    // audit row as an automatic one. See ./cooldown.ts.

    const existing = all.find((x) => canonical(x.name)?.key === c.key);
    if (existing) {
      if (Object.keys(patch).length) {
        db.update(companies).set({ ...patch, updatedAt: now() }).where(eq(companies.id, existing.id)).run();
        logEvent({
          entity: "company", entityId: existing.id, action: "update", actor: meta.actor, source: meta.source,
          summary: `${existing.name} · company updated (${Object.keys(patch).join(", ")})`,
        });
        updated++;
      }
      if (t.cooldownUntil !== undefined) setCompanyCooldown(existing.id, t.cooldownUntil, meta);
      out.push(db.select().from(companies).where(eq(companies.id, existing.id)).get()!);
    } else {
      const tier = t.tier ?? defaultTier(c.key);
      const ts = now();
      const id = db.insert(companies).values({ name: c.name, ...patch, tier, createdAt: ts, updatedAt: ts }).returning({ id: companies.id }).get().id;
      logEvent({
        entity: "company", entityId: id, action: "insert", actor: meta.actor, source: meta.source,
        summary: `new company ${c.name} [${tier}]`,
      });
      inserted++;
      if (t.cooldownUntil !== undefined) setCompanyCooldown(id, t.cooldownUntil, meta);
      out.push(db.select().from(companies).where(eq(companies.id, id)).get()!);
    }
  }
  return { upserted: out, inserted, updated };
}

// Add/remove a company from the discovery watchlist (the scan list) — the separate
// "operations" concern. Matched by canonical name. Adding an untracked company creates a
// minimal record (default tier) so "watch X" works before X is curated; removing an
// untracked one is a no-op. Returns the affected company, or null if nothing to do.
export function setWatchlist(
  name: string,
  on: boolean,
  meta: { actor?: string; source?: string } = {}
): CompanyView | null {
  const c = canonical(name);
  if (!c) return null;
  const existing = db.select().from(companies).all().find((x) => canonical(x.name)?.key === c.key);

  if (!existing) {
    if (!on) return null; // removing a company we don't track → nothing to do
    const tier = defaultTier(c.key);
    const ts = now();
    const id = db.insert(companies).values({ name: c.name, tier, watchlist: true, createdAt: ts, updatedAt: ts }).returning({ id: companies.id }).get().id;
    logEvent({
      entity: "company", entityId: id, action: "insert", actor: meta.actor, source: meta.source,
      summary: `new company ${c.name} [${tier}] · added to watchlist`,
    });
    return toCompanyView(db.select().from(companies).where(eq(companies.id, id)).get()!);
  }

  if (!!existing.watchlist !== on) {
    db.update(companies).set({ watchlist: on, updatedAt: now() }).where(eq(companies.id, existing.id)).run();
    logEvent({
      entity: "company", entityId: existing.id, action: "update", field: "watchlist", actor: meta.actor, source: meta.source,
      summary: `${existing.name} · ${on ? "added to" : "removed from"} watchlist`,
    });
  }
  return toCompanyView(db.select().from(companies).where(eq(companies.id, existing.id)).get()!);
}

// --- scanned postings (the watchlist-scan triage store) ---
export type ScannedView = {
  id: number; company: string; companyId: number; atsId: string | null; title: string;
  location: string | null; url: string | null; department: string | null;
  verdict: string; reason: string | null; state: string; scannedAt: string; updatedAt?: string | null;
  postedAt?: string | null;
  fitScore?: number | null; fit?: FitAssessment; resumeDir?: string | null; leveling?: Leveling;
  redoLog?: RedoTurn[]; comments?: Comment[]; pinned?: boolean;
};
const parseLeveling = (s: string | null): Leveling | undefined => {
  if (!s) return undefined;
  try { const a = JSON.parse(s); return a && typeof a === "object" && !Array.isArray(a) ? (a as Leveling) : undefined; } catch { return undefined; }
};
// your per-posting comment thread (JSON Comment[]). Tolerant: malformed/empty → [].
const parseComments = (s: string | null): Comment[] => {
  if (!s) return [];
  try { const a = JSON.parse(s); return Array.isArray(a) ? (a as Comment[]) : []; } catch { return []; }
};
// A JSON string[] column (e.g. editedResumes) → array of strings; tolerant of null/garbage.
const parseStrArray = (s: string | null): string[] => {
  if (!s) return [];
  try { const a = JSON.parse(s); return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
};
// The email_refs JSON column → EmailRefs (stage → Gmail thread id); undefined when empty/garbage.
const parseEmailRefs = (s: string | null): EmailRefs | undefined => {
  if (!s) return undefined;
  try {
    const o = JSON.parse(s);
    if (!o || typeof o !== "object") return undefined;
    const out: EmailRefs = {};
    for (const k of ["applied", "rejected", "offer", "interview"] as const) if (typeof o[k] === "string" && o[k]) out[k] = o[k];
    return Object.keys(out).length ? out : undefined;
  } catch { return undefined; }
};
// Candidate count per funnel step — `state` IS the step, so this is a plain tally. Keys match the
// discovery-spine step keys (shared/src/pipeline/discovery.ts) one-to-one; the funnel reads them for its badges.
// `terms` (optional) filters to postings whose COMPANY name matches any term (case-insensitive
// substring, OR) — drives the home spine's "where is this company?" filtered heatmap.
export function scannedBucketCounts(terms?: string[]): Record<string, number> {
  const clean = (terms ?? []).map((t) => t.trim()).filter(Boolean);
  const rows = clean.length
    ? db.select({ state: postings.state, companyId: postings.companyId }).from(postings)
        .innerJoin(companies, eq(postings.companyId, companies.id))
        .where(or(...clean.map((t) => like(companies.name, `%${t}%`))))
        .all()
    : db.select({ state: postings.state, companyId: postings.companyId }).from(postings).all();
  const cooling = coolingCompanyIds();
  const c: Record<string, number> = {};
  for (const r of rows) {
    if (isHiddenWhileCooling(cooling, r)) continue;
    c[r.state] = (c[r.state] ?? 0) + 1;
  }
  return c;
}

// List the postings in a funnel step — `state` is the single source of truth (no bucket
// derivation). A step can span several states, so `state` accepts a comma-separated list
// (e.g. "fit_queue,assessed,apply_later").
export function listScannedPostings(f: { company?: string; state?: string } = {}): ScannedView[] {
  const states = f.state ? new Set(f.state.split(",")) : null;
  // A cooling company's untriaged finds are hidden, not deleted — they reappear the day the
  // cooldown lapses or you clear it. Tailoring work stays visible (see isHiddenWhileCooling).
  const cooling = coolingCompanyIds();
  return db
    .select({
      id: postings.id, company: companies.name, companyId: postings.companyId,
      atsId: postings.atsId, title: postings.title, location: postings.location,
      url: postings.url, department: postings.department, verdict: postings.verdict,
      reason: postings.reason, state: postings.state, scannedAt: postings.scannedAt,
      updatedAt: postings.updatedAt, postedAt: postings.postedAt,
      fitScore: postings.fitScore, fitDetail: postings.fitDetail, resumeDir: postings.resumeDir,
      redoLog: postings.redoLog, comments: postings.comments, leveling: companies.leveling,
      pinned: postings.pinned,
    })
    .from(postings)
    .innerJoin(companies, eq(postings.companyId, companies.id))
    .all()
    .map((p) => ({ ...p, fit: parseFit(p.fitDetail), redoLog: parseRedoLog(p.redoLog), comments: parseComments(p.comments), leveling: parseLeveling(p.leveling) }))
    .filter((p) => (!f.company || p.company === f.company) && (!states || states.has(p.state)))
    .filter((p) => !isHiddenWhileCooling(cooling, p))
    .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
}

// Advance a candidate through the discovery stages. queue-fit/tailor/discard stay in the
// candidate (discovery); apply graduates it into the tracker (creates an postings row).
export function scannedAction(
  id: number,
  action: "discard" | "queue-fit" | "tailor" | "apply",
  // apply: the date the user entered/confirmed; defaults to today. queueOnly: hand the work to the agent
  // WITHOUT moving the posting's stage — the queue action is decoupled from status tracking.
  opts?: { appliedDate?: string; queueOnly?: boolean }
): { ok: boolean; appId?: number; fit?: { id: number; company: string; role: string; url?: string; jd?: string }; tailor?: { id: number; company: string; role: string; url?: string; jd?: string } } {
  const row = db.select().from(postings).where(eq(postings.id, id)).get();
  if (!row) return { ok: false };
  const co = db.select().from(companies).where(eq(companies.id, row.companyId)).get();
  const name = co?.name ?? "?";
  const queueOnly = opts?.queueOnly ?? false;

  if (action === "discard") {
    db.update(postings).set({ state: "dismissed" }).where(eq(postings.id, id)).run();
    logEvent({ entity: "company", entityId: row.companyId, action: "update", source: "discovery", summary: `${name} — ${row.title} · discarded` });
    return { ok: true };
  }
  if (action === "queue-fit") {
    // queueOnly: just enqueue the fit job (see the route) — leave the stage alone. Otherwise advance
    // the posting into the fit queue (the status-tracking move) as well.
    if (!queueOnly) {
      db.update(postings).set({ state: "fit_queue" }).where(eq(postings.id, id)).run();
      logEvent({ entity: "company", entityId: row.companyId, action: "update", source: "discovery", summary: `${name} — ${row.title} · queued for fit` });
    } else {
      logEvent({ entity: "company", entityId: row.companyId, action: "update", source: "discovery", summary: `${name} — ${row.title} · fit re-queued` });
    }
    return { ok: true, fit: { id: row.id, company: name, role: row.title, url: row.url ?? undefined, jd: row.jd ?? undefined } };
  }
  if (action === "tailor") {
    // queueOnly: just enqueue the tailoring job — leave the stage alone. Otherwise also enter the
    // tailor stage (the agent fills resumeDir + advances to `tailored` when the resume is ready).
    if (!queueOnly) {
      db.update(postings).set({ state: "tailoring" }).where(eq(postings.id, id)).run();
      logEvent({ entity: "company", entityId: row.companyId, action: "update", source: "discovery", summary: `${name} — ${row.title} · tailoring` });
    } else {
      logEvent({ entity: "company", entityId: row.companyId, action: "update", source: "discovery", summary: `${name} — ${row.title} · tailoring re-queued` });
    }
    // Return a tailor payload so the route enqueues a tailoring job (the agent handoff).
    return { ok: true, tailor: { id: row.id, company: name, role: row.title, url: row.url ?? undefined, jd: row.jd ?? undefined } };
  }
  // apply → graduate into the tracker. One model now: just advance this posting's stage in place
  // (no separate applications row), stamping the apply metadata.
  db.update(postings)
    .set({ state: "applied", source: row.source ?? "scan", appliedDate: opts?.appliedDate ?? today(), discoveredAt: row.discoveredAt ?? row.scannedAt.slice(0, 10) })
    .where(eq(postings.id, id))
    .run();
  logEvent({ entityId: id, action: "update", source: "discovery", summary: `${name} — ${row.title} · applied → tracker` });
  return { ok: true, appId: id };
}

// the agent's superficial glance verdict (title + location, no JD) on a scanned candidate. The glance
// no longer auto-queues to fit — high & low both land in `review` (the Watchlist "Scan results" tab)
// for you to triage; only drop is discarded. Finds the existing scanned row (by ats id, else url);
// creates one if missing (careers-get/browser companies the agent fetched itself).
export type GlanceInput = {
  company: string; atsId?: string | null; url?: string | null; title?: string | null;
  location?: string | null; department?: string | null; glance: "high" | "low" | "drop"; reason?: string | null;
};
export function applyGlance(v: GlanceInput): { ok: boolean; appId?: number; outcome?: "review" | "discarded" } {
  const c = canonical(v.company);
  const co = c ? db.select().from(companies).all().find((x) => canonical(x.name)?.key === c.key) : null;
  if (!co) return { ok: false };

  const rows = db.select().from(postings).where(eq(postings.companyId, co.id)).all();
  // Match an existing scanned row: by ATS id, else exact url, else normalized TITLE within the
  // company. The title fallback is what dedups non-API companies (no atsId, e.g. Apple) whose
  // careers-page URLs vary per glance — so the same role doesn't spawn a fresh row every scan.
  const wantTitle = norm(v.title ?? "");
  const row =
    (v.atsId ? rows.find((r) => r.atsId === v.atsId) : undefined) ??
    (v.url ? rows.find((r) => r.url === v.url) : undefined) ??
    (wantTitle ? rows.find((r) => norm(r.title) === wantTitle) : undefined);

  const title = v.title ?? row?.title ?? "(untitled)";
  const department = v.department ?? row?.department ?? null;
  // Shared exclude — the same filter the api scan uses — overrides the agent's call (EM/TPM/
  // Security/intern/Solutions etc.), so every fetch method gets a uniform floor.
  const excluded = isExcludedTitle(title, department);
  // Same shape of server-side override as the exclude filter: a company cooling off after rejecting
  // you doesn't get its finds put in front of you, whatever the agent thought of them.
  const cooling = isCompanyCooling(co);
  const glance = excluded || cooling ? "drop" : v.glance;
  // high & low both go to `review` (you triage them in the Scan-results tab); only drop is discarded.
  // A cooled find is `filtered`, not `dismissed` — filed by a rule, not a decision you made.
  const state = (cooling ? "filtered" : glance === "drop" ? "dismissed" : "review") as "review" | "dismissed" | "filtered";
  const outcome: "review" | "discarded" = glance === "drop" ? "discarded" : "review";
  const fields = {
    title,
    location: v.location ?? row?.location ?? null,
    url: v.url ?? row?.url ?? null,
    department,
    verdict: (glance === "drop" ? "dropped" : "kept") as "kept" | "dropped",
    reason: cooling ? "cooldown" : excluded ? "excluded" : v.reason ?? null,
    state,
  };

  // Leave anything you've already triaged / queued / applied alone — a re-glance must never pull a
  // posting you've acted on back into the triage pile.
  const DECIDED = new Set(["fit_queue", "assessed", "apply_later", "tailoring", "tailored", "applied", "interview", "offer", "accepted", "rejected", "ghost", "withdrawn", "company_skipped", "expired"]);
  if (row && DECIDED.has(row.state)) return { ok: true, outcome };

  let candId: number;
  if (row) {
    db.update(postings).set(fields).where(eq(postings.id, row.id)).run();
    candId = row.id;
  } else {
    candId = db.insert(postings).values({ companyId: co.id, atsId: v.atsId ?? null, scannedAt: new Date().toISOString(), ...fields }).returning({ id: postings.id }).get().id;
  }

  logEvent({ entity: "company", entityId: co.id, action: "update", source: "glance", summary: `${co.name} — ${fields.title} · ${excluded ? "excluded (filter)" : "glance:" + v.glance + " → scan results"}` });
  return { ok: true, appId: candId, outcome };
}

// --- change-log feed + review queue ---
export type EventView = Pick<
  EventRow,
  "id" | "ts" | "actor" | "source" | "entity" | "entityId" | "action" | "field" | "oldValue" | "newValue" | "summary"
>;

export function listEvents(limit = 200): EventView[] {
  return db
    .select({
      id: events.id,
      ts: events.ts,
      actor: events.actor,
      source: events.source,
      entity: events.entity,
      entityId: events.entityId,
      action: events.action,
      field: events.field,
      oldValue: events.oldValue,
      newValue: events.newValue,
      summary: events.summary,
    })
    .from(events)
    .orderBy(desc(events.id))
    .limit(limit)
    .all();
}

export function listNeedsReview(): Posting[] {
  return db
    .select()
    .from(postings)
    .innerJoin(companies, eq(postings.companyId, companies.id))
    .where(eq(postings.needsReview, true))
    .all()
    .map((r) => toPosting(r.postings, r.companies));
}

// Resolve a flagged application. confirm = keep + clear flag; reject = mark skipped.
export function resolveReview(id: number, decision: "confirm" | "reject"): Posting | null {
  const before = getPosting(id);
  if (!before) return null;
  if (decision === "confirm") {
    db.update(postings).set({ needsReview: false, updatedAt: today() }).where(eq(postings.id, id)).run();
    logEvent({ entityId: id, action: "update", summary: `${before.company} — ${before.role} · confirmed (review cleared)` });
  } else {
    db.update(postings).set({ needsReview: false, state: "company_skipped", updatedAt: today() }).where(eq(postings.id, id)).run();
    logEvent({ entityId: id, action: "update", summary: `${before.company} — ${before.role} · marked not submitted → skipped` });
  }
  return getPosting(id);
}

// --- pending (ambiguous) ingestion matches ---
export const matchSignature = (rec: IncomingApp) =>
  `${norm(rec.role ?? "")}|${rec.status}|${rec.appliedDate ?? ""}`;

// Park an ambiguous match for human approval. Idempotent: a re-sync producing the same
// (company, signature) does not stack a duplicate pending row.
export function createPendingMatch(args: {
  actor: string; source: string; companyId: number; companyName: string;
  rec: IncomingApp; candidateIds: number[];
}): boolean {
  const signature = matchSignature(args.rec);
  const dup = db
    .select({ id: pendingMatches.id })
    .from(pendingMatches)
    .where(and(
      eq(pendingMatches.companyId, args.companyId),
      eq(pendingMatches.signature, signature),
      eq(pendingMatches.status, "pending"),
    ))
    .get();
  if (dup) return false;
  db.insert(pendingMatches).values({
    createdAt: new Date().toISOString(),
    actor: args.actor,
    source: args.source,
    companyId: args.companyId,
    companyName: args.companyName,
    signature,
    payload: JSON.stringify(args.rec),
    candidateIds: JSON.stringify(args.candidateIds),
    status: "pending",
  }).run();
  return true;
}

// Park a change an inbox sync WANTS to make, for you to approve on the Changes page. `postingId` is
// the posting it would edit, or null when it's proposing a brand-new posting (approve = "new").
//
// Keyed on (company, posting, incoming signature) so a daily sync re-proposing the same thing does
// NOT stack cards — but unlike the other park helpers this REFRESHES a still-pending row instead of
// bailing: a later sync that learned more (another interview round scheduled) should show you the
// current proposal, not the stale one you haven't gotten to yet. Returns whether a NEW card
// appeared, so a refresh doesn't re-announce itself in the run summary.
export function createPendingChange(args: {
  actor: string; source: string; companyId: number; companyName: string;
  rec: IncomingApp; postingId: number | null; diffs: FieldDiff[];
}): boolean {
  const signature = `change|${args.postingId ?? "new"}|${matchSignature(args.rec)}`;
  const payload = JSON.stringify({ rec: args.rec, diffs: args.diffs });
  const existing = db
    .select({ id: pendingMatches.id })
    .from(pendingMatches)
    .where(and(
      eq(pendingMatches.companyId, args.companyId),
      eq(pendingMatches.signature, signature),
      eq(pendingMatches.status, "pending"),
    ))
    .get();
  if (existing) {
    db.update(pendingMatches).set({ payload }).where(eq(pendingMatches.id, existing.id)).run();
    return false;
  }
  db.insert(pendingMatches).values({
    createdAt: new Date().toISOString(),
    actor: args.actor,
    source: args.source,
    companyId: args.companyId,
    companyName: args.companyName,
    signature,
    payload,
    candidateIds: JSON.stringify(args.postingId == null ? [] : [args.postingId]),
    kind: "change",
    status: "pending",
  }).run();
  return true;
}

// Park an "unbound result": a fit/tailor result whose echoed posting `id` didn't resolve. It's an
// alert for You to look at (resolve = dismiss only), surfaced alongside match approvals. Idempotent
// on (companyId, signature) so re-submitting the same broken result doesn't stack a duplicate.
export function enqueueUnboundResult(args: {
  source: string; companyId: number; companyName: string;
  jobType: string; declaredId?: number; role?: string | null;
  record: unknown; candidateIds: number[];
}): boolean {
  const signature = `unbound|${args.jobType}|${args.declaredId ?? ""}`;
  const dup = db
    .select({ id: pendingMatches.id })
    .from(pendingMatches)
    .where(and(eq(pendingMatches.companyId, args.companyId), eq(pendingMatches.signature, signature), eq(pendingMatches.status, "pending")))
    .get();
  if (dup) return false;
  db.insert(pendingMatches).values({
    createdAt: new Date().toISOString(),
    actor: "CoWork", source: args.source,
    companyId: args.companyId, companyName: args.companyName,
    signature,
    payload: JSON.stringify({ jobType: args.jobType, declaredId: args.declaredId ?? null, role: args.role ?? null, record: args.record }),
    candidateIds: JSON.stringify(args.candidateIds),
    kind: "unbound",
    status: "pending",
  }).run();
  return true;
}

export type PendingMatchView = {
  id: number;
  createdAt: string;
  kind: "match" | "unbound" | "change";
  companyName: string;
  detail?: string; // unbound: a human-readable "couldn't bind" message
  incoming: { role: string | null; status: string; note: string | null; appliedDate: string | null };
  candidates: { id: number; role: string | null; status: string; appliedDate: string | null }[];
  // change: what the sync proposes, already in plain English, plus whether approving CREATES the
  // posting (no candidate to apply onto) and the role line to head the card with.
  changes?: DescribedChange[];
  create?: boolean;
  role?: string | null;
};

export function listPendingMatches(): PendingMatchView[] {
  const rows = db.select().from(pendingMatches).where(eq(pendingMatches.status, "pending")).orderBy(desc(pendingMatches.id)).all();
  if (rows.length === 0) return [];
  const allIds = [...new Set(rows.flatMap((r) => JSON.parse(r.candidateIds) as number[]))];
  const apps = allIds.length
    ? db.select().from(postings).where(inArray(postings.id, allIds)).all()
    : [];
  const byId = new Map(apps.map((a) => [a.id, a]));
  const candidatesOf = (ids: number[]) => ids.map((id) => {
    const a = byId.get(id);
    return { id, role: a?.title ?? null, status: a?.state ?? "?", appliedDate: a?.appliedDate ?? null };
  });
  return rows.map((r) => {
    const ids = JSON.parse(r.candidateIds) as number[];
    if (r.kind === "unbound") {
      const u = JSON.parse(r.payload) as { jobType: string; declaredId: number | null; role: string | null };
      return {
        id: r.id, createdAt: r.createdAt, kind: "unbound" as const, companyName: r.companyName,
        detail: `the agent's ${u.jobType} result couldn't find posting #${u.declaredId ?? "?"}${u.role ? ` (“${u.role}”)` : ""} — it was skipped.`,
        incoming: { role: u.role, status: `${u.jobType} result`, note: null, appliedDate: null },
        candidates: candidatesOf(ids),
      };
    }
    if (r.kind === "change") {
      const { rec, diffs } = JSON.parse(r.payload) as { rec: IncomingApp; diffs: FieldDiff[] };
      const target = ids.length ? byId.get(ids[0]) : undefined;
      return {
        id: r.id, createdAt: r.createdAt, kind: "change" as const, companyName: r.companyName,
        incoming: { role: rec.role ?? null, status: rec.status, note: rec.note ?? null, appliedDate: rec.appliedDate ?? null },
        candidates: candidatesOf(ids),
        changes: describeChanges(diffs),
        create: ids.length === 0,
        // The posting's own title where there is one — the email's phrasing of the role is often
        // looser ("Senior SWE (Ads team)") than what you're tracking.
        role: target?.title ?? rec.role ?? null,
      };
    }
    const rec = JSON.parse(r.payload) as IncomingApp;
    return {
      id: r.id, createdAt: r.createdAt, kind: "match" as const, companyName: r.companyName,
      incoming: { role: rec.role ?? null, status: rec.status, note: rec.note ?? null, appliedDate: rec.appliedDate ?? null },
      candidates: candidatesOf(ids),
    };
  });
}
