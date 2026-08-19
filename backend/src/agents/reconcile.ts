import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { companies, postings, pendingMatches } from "../db/schema";
import type { PostingRow, CompanyRow } from "../db/schema";
import { logEvent, createPendingMatch, createPendingChange, upsertInterviews } from "../db/queries";
import type { FieldDiff } from "@landed/shared/format/change";
import { TRACKER_STAGES } from "@landed/shared/pipeline/stages";
import { emitStageChange } from "../db/stage-change";
import { applyRejectionCooldown } from "../db/cooldown";
import { canonical, defaultTier } from "@landed/shared/agents/canonical";
import { matchPosting, interviewNarrowed, type MatchResult } from "@landed/shared/agents/match";
import type { IncomingApp, ReconcileResult } from "@landed/shared/agents/types";

const today = () => new Date().toISOString().slice(0, 10);
const blank = (v: unknown) => v === null || v === undefined || v === "";

// Incoming descriptive fields to take-latest. `role` maps to the posting's `title` column.
const TAKE_LATEST: (keyof IncomingApp)[] = ["role", "level", "team", "location", "channel", "source", "url", "note"];
const colOf = (f: keyof IncomingApp): keyof PostingRow => (f === "role" ? "title" : (f as keyof PostingRow));

// Map an incoming status onto a posting stage (the early board status `discovered` is the funnel's
// fit_queue; everything else is already a valid stage).
const toStage = (s?: string | null) => (s === "discovered" ? "fit_queue" : s) as PostingRow["state"];

// Exact-match pool: every stage a confident URL/exact-title match may land on — tracker stages
// (status progression: applied→interview, idempotent re-sync) PLUS all pre-apply candidates. In the
// unified model a candidate and its applied row are the SAME row, so an "applied" email for a posting
// you were tailoring graduates THAT row, not a duplicate. Excludes only dropped rows (dismissed/filtered).
const MATCH_STAGES: PostingRow["state"][] = [
  ...TRACKER_STAGES, "review", "matched", "fit_queue", "assessed", "tailoring", "tailored", "apply_later",
];
// Fuzzy/approval pool: only the PRE-APPLY candidate stages. A non-exact (fuzzy) match is offered for
// human approval, and we only ever ask about a posting you're still pursuing — never re-point an
// email at an already-applied, interviewing, or closed row (that'd be a separate application).
const FUZZY_STAGES = new Set<string>(["review", "matched", "fit_queue", "assessed", "tailoring", "tailored", "apply_later"]);

// Status progression rank. Sync may ADVANCE status but never walk it backward —
// e.g. an old interview-scheduling email must not un-reject a closed application.
const STATUS_RANK: Record<string, number> = {
  discovered: 0, fit_queue: 0, assessed: 1, tailoring: 1, tailored: 1, company_skipped: 0,
  applied: 2, ghost: 2, interview: 3, rejected: 4, expired: 4,
};
const rank = (s?: string | null) => STATUS_RANK[s ?? ""] ?? 0;

// Matching now lives in ./match (matchPosting / exactMatch / fuzzy tier) — one shared decision for
// every ingest path. reconcile() calls it below with MATCH_STAGES (exact) + FUZZY_STAGES (ask).

// What an incoming record WOULD do to a matched posting: take-latest descriptive fields, advance
// (never regress) status, monotonic interviewed, fill blank appliedDate, merge Gmail thread ids.
// Pure w.r.t. the DB — it only reads — so the approval flow can show you the exact change before it
// happens and `applyIncoming` can then perform precisely that. One computation, two uses: a preview
// can never drift from the write.
export function planIncoming(match: PostingRow, rec: IncomingApp): {
  changes: Record<string, unknown>;
  fieldDiffs: FieldDiff[];
  roundsChanged: number;
  emailChanged: boolean;
  empty: boolean;
} {
  const changes: Record<string, unknown> = {};
  const fieldDiffs: FieldDiff[] = [];
  const str = (v: unknown) => (blank(v) ? undefined : String(v));
  const note = (field: string, oldV: unknown, newV: unknown) => fieldDiffs.push({ field, old: str(oldV), new: str(newV) });

  for (const f of TAKE_LATEST) {
    const col = colOf(f);
    const v = rec[f];
    if (blank(v) || v === match[col]) continue;
    changes[col] = v;
    note(f, match[col], v);
  }
  const incomingStage = toStage(rec.status);
  if (rec.status && incomingStage !== match.state && rank(incomingStage) > rank(match.state)) {
    changes.state = incomingStage;
    note("status", match.state, incomingStage);
  }
  // Interview rounds imply interviewed; they also keep the stage from regressing below interview.
  if ((rec.interviewed || rec.interviews?.length) && !match.interviewed) { changes.interviewed = true; note("interviewed", "no", "yes"); }
  if (blank(match.appliedDate) && !blank(rec.appliedDate)) { changes.appliedDate = rec.appliedDate; note("appliedDate", undefined, rec.appliedDate); }

  // Interview rounds, counted against what's stored (dry — the write happens in applyIncoming).
  // Counts as a change even when no posting field moved.
  const roundsChanged = rec.interviews?.length ? upsertInterviews(match.id, rec.interviews, { dryRun: true }) : 0;
  if (roundsChanged) note("interviews", undefined, `${roundsChanged} round${roundsChanged === 1 ? "" : "s"}`);

  // Merge captured Gmail thread ids per stage onto the posting (link metadata — no event/diff noise).
  let emailChanged = false;
  if (rec.emailRefs && Object.keys(rec.emailRefs).length) {
    const cur = (() => { try { return match.emailRefs ? JSON.parse(match.emailRefs) : {}; } catch { return {}; } })();
    const merged = { ...cur, ...rec.emailRefs };
    if (JSON.stringify(merged) !== JSON.stringify(cur)) { changes.emailRefs = JSON.stringify(merged); emailChanged = true; }
  }

  return { changes, fieldDiffs, roundsChanged, emailChanged, empty: !fieldDiffs.length && !roundsChanged && !emailChanged };
}

// Perform the planned change: write it, log one event per field, return the terse diff strings the
// run summary quotes. Mutates `match` in place so later records in the same run see the new values.
function applyIncoming(
  match: PostingRow,
  rec: IncomingApp,
  opts: { actor: string; source: string; companyName: string }
): { diffs: string[]; summary: string } {
  const { changes, fieldDiffs, roundsChanged, empty } = planIncoming(match, rec);
  if (roundsChanged) upsertInterviews(match.id, rec.interviews!); // the real write the plan counted

  const diffs = fieldDiffs.map((d) => `${d.field} ${d.old ?? "∅"}→${d.new ?? "∅"}`);
  if (empty) return { diffs, summary: "" };
  const prevStage = match.state;
  changes.updatedAt = rec.updatedAt ?? today();
  db.update(postings).set(changes as Partial<typeof postings.$inferInsert>).where(eq(postings.id, match.id)).run();
  Object.assign(match, changes); // reflect in the pool so later records match the new values
  // Reaching the interview stage via sync earns prep research (one-shot per company) — announced,
  // not enqueued from here; the jobs layer subscribes. See ../db/stage-change.ts.
  if (changes.state === "interview") emitStageChange({ companyId: match.companyId, from: prevStage, to: "interview" });
  // A synced rejection can earn the company a cooldown, exactly as the UI path does.
  if (changes.state === "rejected") applyRejectionCooldown(match.companyId, match.id);
  // One event per field changed — the actor (the agent for inbox-sync) wrote these.
  const subject = `${opts.companyName} — ${match.title ?? rec.role ?? "?"}`;
  for (const d of fieldDiffs) {
    logEvent({ actor: opts.actor, source: opts.source, entityId: match.id, action: "update", field: d.field, oldValue: d.old, newValue: d.new, summary: subject });
  }
  const summary = `${subject} · ${diffs.join(", ")}`;
  return { diffs, summary };
}

// Insert a brand-new posting from an incoming record. Logs the event; returns the new row
// (so callers can grow their pool) plus the action + logged summary.
function insertIncoming(
  co: CompanyRow,
  rec: IncomingApp,
  opts: { actor: string; source: string }
): { row: PostingRow; action: string; summary: string } {
  const base = {
    companyId: co.id,
    title: rec.role ?? "(untitled)", level: rec.level ?? null, team: rec.team ?? null, location: rec.location ?? null,
    state: toStage(rec.status), channel: (rec.channel ?? null) as PostingRow["channel"], source: rec.source ?? null, url: rec.url ?? null, note: rec.note ?? null,
    interviewed: rec.interviewed ?? false, needsReview: rec.needsReview ?? false, historical: false,
    appliedDate: rec.appliedDate ?? null, updatedAt: rec.updatedAt ?? today(),
    emailRefs: rec.emailRefs && Object.keys(rec.emailRefs).length ? JSON.stringify(rec.emailRefs) : null,
    verdict: "kept" as const, reason: null, scannedAt: new Date().toISOString(),
  };
  const id = db.insert(postings).values(base).returning({ id: postings.id }).get().id;
  if (rec.interviews?.length) upsertInterviews(id, rec.interviews); // attach any interview rounds
  const full = { id, atsId: null, department: null, fitScore: null, fitDetail: null, jd: null, resumeDir: null, redoLog: null, discoveredAt: null, ...base } as PostingRow;
  const action = rec.needsReview ? "flag" : "insert";
  const summary = `${co.name} — ${rec.role ?? "?"} · ${rec.status}${rec.interviewed ? " · interviewed" : ""}${rec.needsReview ? " · NEEDS REVIEW" : ""}`;
  logEvent({ actor: opts.actor, source: opts.source, entityId: id, action, summary });
  // An inbox sync can land a posting straight into `rejected` for a req you never tracked — the
  // third way a rejection enters the app, and it earns a cooldown like the other two.
  if (base.state === "rejected") applyRejectionCooldown(co.id, id);
  return { row: full, action, summary };
}

// Find the best existing company by canonical key; create one (preserving default tier)
// if none exists. Normalizes the stored name to the canonical form.
//
// ...except under `approval`, where renaming would breach the very boundary the caller asked for:
// an inbox sync infers company names out of email prose, so one hallucinated spelling would
// silently rename a company you actually track, with no card to reject. Matching is by canonical
// KEY, so declining the rename costs nothing — the record still lands on the right company, and the
// proposal shows the tracker's spelling. (A company that doesn't exist yet is still created: the
// parked proposal has to hang off a companyId. See createPendingChange.)
function resolveCompany(key: string, name: string, actor: string, source: string, approval?: boolean): { co: CompanyRow; isNew: boolean } {
  const all = db.select().from(companies).all();
  const existing = all.find((c) => canonical(c.name)?.key === key);
  if (existing) {
    if (approval) return { co: existing, isNew: false };
    if (existing.name !== name) db.update(companies).set({ name, updatedAt: new Date().toISOString() }).where(eq(companies.id, existing.id)).run();
    return { co: { ...existing, name }, isNew: false };
  }
  const tier = defaultTier(key);
  const ts = new Date().toISOString();
  const id = db.insert(companies).values({ name, tier, createdAt: ts, updatedAt: ts }).returning({ id: companies.id }).get().id;
  logEvent({ actor, source, entity: "company", entityId: id, action: "insert", summary: `new company ${name} [${tier}]` });
  return {
    co: { id, name, tier, careersUrl: null, ats: null, fetchMethod: null, fetchRecipe: null, notes: null, desire: null, slug: null, endpoint: null, targetTitles: null, targetLocation: null, leveling: null, lastScrapedAt: null, watchlist: false, cooldownUntil: null, createdAt: ts, updatedAt: ts },
    isNew: true,
  };
}

// The fields worth naming on a "create this posting" card. The stage plus how you applied — enough
// to judge the proposal without reproducing the whole row.
const CREATE_PREVIEW: (keyof IncomingApp)[] = ["status", "level", "team", "location", "channel", "source", "appliedDate", "url"];
const previewOfNew = (rec: IncomingApp): FieldDiff[] =>
  CREATE_PREVIEW.filter((f) => !blank(rec[f])).map((f) => ({ field: f, new: String(rec[f]) }));

// Incrementally merge normalized records into the DB. Idempotent: re-running the
// same input produces no changes. Returns a summary and logs per-row events.
// Ambiguous matches (2+ postings) are NOT guessed — they're parked in pending_matches
// for the user to resolve, leaving the posting rows untouched.
//
// `approval` (set for inbox-sync) holds back EVERY write: a confident match becomes a proposed
// change and a brand-new posting becomes a proposed create, both parked for you to approve on the
// Changes page. Email is inference — the agent reads intent out of prose — so nothing it concludes
// edits your tracker unattended. Other sources (your own edits, discovery) reconcile directly.
export function reconcile(
  records: IncomingApp[],
  opts: { actor: string; source: string; dryRun?: boolean; approval?: boolean }
): ReconcileResult {
  const { actor, source, dryRun, approval } = opts;
  let inserted = 0, updated = 0, fieldChanges = 0, flagged = 0, pending = 0, newCompanies = 0, skipped = 0;
  const details: { action: string; summary: string }[] = [];

  // group incoming by canonical company
  const groups = new Map<string, { name: string; recs: IncomingApp[] }>();
  for (const rec of records) {
    const c = canonical(rec.company);
    // No canonical company → there's nothing to match or create against, so the record can't be
    // used. Count it: dropping it silently is what makes a broken run look like an empty one.
    if (!c) { skipped++; continue; }
    if (!groups.has(c.key)) groups.set(c.key, { name: c.name, recs: [] });
    groups.get(c.key)!.recs.push(rec);
  }

  try {
    db.transaction(() => {
    for (const [key, g] of groups) {
      const { co, isNew } = resolveCompany(key, g.name, actor, source, approval);
      if (isNew) newCompanies++;
      // Mutable pool: the company's tracker postings + active pre-apply candidates (MATCH_STAGES),
      // growing with rows inserted this run so later identical records merge instead of duplicating.
      // Including tailoring/tailored/assessed/apply_later means an "applied" email graduates the
      // the candidate was working in place — no duplicate tracker row.
      const pool: PostingRow[] = db.select().from(postings)
        .where(and(eq(postings.companyId, co.id), inArray(postings.state, MATCH_STAGES))).all();

      for (const rec of g.recs) {
        // An interview email is about a posting you're already interviewing for — match it against
        // those rows alone (see interviewNarrowed). A single one is the answer outright; several
        // still go through the normal decision, just over the interview rows.
        const narrowed = interviewNarrowed(pool, rec);
        const res: MatchResult = narrowed
          ? (narrowed.length === 1 ? { kind: "unique", app: narrowed[0] } : matchPosting(narrowed, rec, { fuzzyStates: FUZZY_STAGES }))
          : matchPosting(pool, rec, { fuzzyStates: FUZZY_STAGES });

        if (res.kind === "none") {
          if (approval) {
            // Propose the new posting instead of creating it. No `pool.push` — the row doesn't
            // exist yet, so a second record for the same role this run proposes against the same
            // signature and dedups in createPendingChange rather than double-creating on approval.
            if (createPendingChange({
              actor, source, companyId: co.id, companyName: co.name,
              rec, postingId: null, diffs: previewOfNew(rec),
            })) {
              pending++;
              details.push({ action: "flag", summary: `${co.name} — ${rec.role ?? "?"} · new posting, awaiting your approval` });
            }
            continue;
          }
          const { row, action, summary } = insertIncoming(co, rec, { actor, source });
          pool.push(row);
          inserted++;
          if (action === "flag") flagged++;
          details.push({ action, summary });
          continue;
        }

        // Fuzzy (non-exact, e.g. email missing the team) and ambiguous (exact 2+) both go to human
        // approval — never auto-applied. The Match-review UI lets You pick the posting / + New /
        // Dismiss; resolvePendingMatch then graduates the chosen candidate in place.
        if (res.kind === "fuzzy" || res.kind === "ambiguous") {
          const created = createPendingMatch({
            actor, source, companyId: co.id, companyName: co.name,
            rec, candidateIds: res.candidates.map((c) => c.id),
          });
          if (created) {
            pending++;
            const why = res.kind === "fuzzy" ? "fuzzy title, confirm match" : "ambiguous, needs match";
            details.push({ action: "flag", summary: `${co.name} — ${rec.role ?? "?"} · ${rec.status}: ${why} (${res.candidates.length} posting${res.candidates.length === 1 ? "" : "s"})` });
          }
          continue;
        }

        // unique → apply it, or (approval mode) propose exactly what it would do and stop there.
        if (approval) {
          const plan = planIncoming(res.app, rec);
          if (plan.empty) continue; // nothing to decide — a re-sync that changes nothing stays silent
          if (createPendingChange({
            actor, source, companyId: co.id, companyName: co.name,
            rec, postingId: res.app.id, diffs: plan.fieldDiffs,
          })) {
            pending++;
            details.push({ action: "flag", summary: `${co.name} — ${res.app.title ?? rec.role ?? "?"} · ${plan.fieldDiffs.length} change${plan.fieldDiffs.length === 1 ? "" : "s"}, awaiting your approval` });
          }
          continue;
        }
        const { diffs, summary } = applyIncoming(res.app, rec, { actor, source, companyName: co.name });
        if (diffs.length) {
          updated++;
          fieldChanges += diffs.length;
          details.push({ action: "update", summary });
        }
      }
    }
    // dry run: undo everything (writes + logged events) by rolling back the transaction
    if (dryRun) {
      const e = new Error("__dryrun_rollback__") as Error & { __dryrun?: boolean };
      e.__dryrun = true;
      throw e;
    }
    });
  } catch (e) {
    if (!(e as { __dryrun?: boolean })?.__dryrun) throw e;
  }

  // In approval mode nothing was written, so a "0 new · 0 updated" line would read as "the sync found
  // nothing" when it actually found plenty and is waiting on you. Say what's true instead.
  // Skipped records are appended to BOTH forms: "nothing new" plus a skip count is the sentence that
  // distinguishes a run that lost records from one that had nothing to say.
  const skippedClause = skipped ? ` · ${skipped} record${skipped === 1 ? "" : "s"} skipped (no company)` : "";
  const summary = (approval
    ? (pending === 0
        ? `nothing new — no changes to approve${newCompanies ? ` · ${newCompanies} new companies` : ""}`
        : `${pending} to approve on the Changes page${newCompanies ? ` · ${newCompanies} new companies` : ""}`)
    : `${inserted} new · ${updated} updated (${fieldChanges} fields) · ${flagged} flagged · ${pending} to match · ${newCompanies} new companies`)
    + skippedClause;
  return { inserted, updated, fieldChanges, flagged, pending, newCompanies, skipped, summary, details };
}

// Resolve a parked item once the user decides. "apply" merges the incoming record onto the chosen
// posting (actor=You — the human's call is the truth); "new" inserts it as a fresh posting;
// "dismiss" drops it. Covers both parked kinds: an ambiguous `match` (which posting is this?) and a
// `change` an inbox sync proposed (approve this?) — both carry the same IncomingApp payload, so
// approving is just running the merge the sync held back.
export function resolvePendingMatch(
  id: number,
  decision: "apply" | "new" | "dismiss",
  appId?: number
): { ok: boolean; error?: string } {
  const row = db.select().from(pendingMatches).where(eq(pendingMatches.id, id)).get();
  if (!row || row.status !== "pending") return { ok: false, error: "not found" };

  const finish = (resolvedAppId?: number) =>
    db.update(pendingMatches).set({
      status: decision === "dismiss" ? "dismissed" : "resolved",
      resolvedAppId: resolvedAppId ?? null,
      resolvedAt: new Date().toISOString(),
    }).where(eq(pendingMatches.id, id)).run();

  if (decision === "dismiss") { finish(); return { ok: true }; }

  // Unbound results (fit/tailor id-miss) are alerts — there's no IncomingApp to apply. Dismiss only.
  if (row.kind === "unbound") return { ok: false, error: "unbound result: dismiss only" };

  // A `change` row wraps the record alongside the diff it was proposing; a `match` row is the bare
  // record. Either way what gets applied is the IncomingApp, re-planned against the posting as it
  // stands NOW — so a proposal you sat on can't apply a change the row has since outgrown.
  const payload = JSON.parse(row.payload) as IncomingApp | { rec: IncomingApp; diffs: FieldDiff[] };
  const rec = (row.kind === "change" ? (payload as { rec: IncomingApp }).rec : payload) as IncomingApp;
  if (decision === "apply") {
    if (!appId) return { ok: false, error: "appId required" };
    const candidateIds = JSON.parse(row.candidateIds) as number[];
    if (!candidateIds.includes(appId)) return { ok: false, error: "not a candidate" };
    const match = db.select().from(postings).where(eq(postings.id, appId)).get();
    if (!match) return { ok: false, error: "application not found" };
    applyIncoming(match, rec, { actor: "You", source: row.source, companyName: row.companyName });
    finish(appId);
    return { ok: true };
  }

  // decision === "new"
  const co = db.select().from(companies).where(eq(companies.id, row.companyId)).get();
  if (!co) return { ok: false, error: "company not found" };
  const { row: created } = insertIncoming(co, rec, { actor: "You", source: row.source });
  finish(created.id);
  return { ok: true };
}
