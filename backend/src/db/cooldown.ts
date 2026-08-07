import { eq, gt, inArray } from "drizzle-orm";
import { db } from "./index";
import { companies, interviews, postings } from "./schema";
import type { CompanyRow } from "./schema";
import { logEvent } from "./events";
import type { InterviewKind, Status } from "@landed/shared/types";
import {
  companyCooldown, cooldownFromRejection, extendCooldown, isCooling, isValidCooldownDate,
  type CooldownDecision, type CooldownPosting,
} from "@landed/shared/pipeline/cooldown";

// The company cooldown, DB side: reading whether a company is cooling, and writing when it should
// be. The decision itself is pure and lives in shared/src/pipeline/cooldown.ts — this file only
// loads the rows, applies it, and records what changed.
//
// Deliberately a LEAF of the db layer: queries.ts imports this, so this must not import queries.ts.
// The audit row goes through ./events, which is a leaf for exactly that reason.

const today = () => new Date().toISOString().slice(0, 10);

// Is this company off-limits right now? Takes a row the caller already holds, so the scan queue and
// the ingest path don't each re-query.
export function isCompanyCooling(co: Pick<CompanyRow, "cooldownUntil">, at = today()): boolean {
  return isCooling(co.cooldownUntil, at);
}

// Company ids currently cooling — one query, for call sites filtering a list. Filtered in SQL:
// YYYY-MM-DD compares lexicographically, so this normally returns a near-empty set instead of
// dragging every company's JSON blobs into memory to read one date.
export function coolingCompanyIds(at = today()): Set<number> {
  return new Set(
    db.select({ id: companies.id }).from(companies).where(gt(companies.cooldownUntil, at)).all().map((c) => c.id),
  );
}

function writeCooldown(
  co: CompanyRow,
  until: string | null,
  why: string,
  meta: { actor?: string; source?: string } = {},
): string | null {
  if ((co.cooldownUntil ?? null) === until) return until;
  db.update(companies).set({ cooldownUntil: until, updatedAt: new Date().toISOString() }).where(eq(companies.id, co.id)).run();
  logEvent({
    ...meta,
    entity: "company",
    entityId: co.id,
    action: "update",
    field: "cooldownUntil",
    oldValue: co.cooldownUntil ?? undefined,
    newValue: until ?? undefined,
    summary: until ? `${co.name} · discovery paused until ${until} (${why})` : `${co.name} · cooldown cleared`,
  });
  return until;
}

// Store a decision the pure rule just made. Only ever EXTENDS an existing date, never shortens one —
// which is what lets a hand-lengthened cooldown survive a later automatic one. A decision of
// "doesn't cool" is not a decision to clear: clearing is only ever explicit (setCompanyCooldown).
function applyDecision(co: CompanyRow, decision: CooldownDecision): string | null {
  if (!decision.cool) return co.cooldownUntil;
  return writeCooldown(co, extendCooldown(co.cooldownUntil, decision.until), `rejected ${decision.from} after an interview`);
}

// Every posting at a company, in the shape the pure rule reads — four fields, no invented company
// name or tier (see CooldownPosting).
//
// `roundsFor` limits the interview-round load. The rounds only decide whether a rejection was a real
// loop, and the write path judges ONE rejection, so it asks for just that posting's rounds; every
// other posting is there to answer "are you still in play here?", which needs only `status`. The
// backfill omits it and pays for the full fan-out, because it judges every posting.
function postingsFor(co: CompanyRow, roundsFor?: number): CooldownPosting[] {
  const rows = db.select().from(postings).where(eq(postings.companyId, co.id)).all();
  if (!rows.length) return [];
  const wanted = roundsFor == null ? rows.map((x) => x.id) : [roundsFor];
  const kindsByPosting = new Map<number, InterviewKind[]>();
  for (const r of db.select().from(interviews).where(inArray(interviews.applicationId, wanted)).all()) {
    const list = kindsByPosting.get(r.applicationId) ?? [];
    if (r.kind) list.push(r.kind as InterviewKind);
    kindsByPosting.set(r.applicationId, list);
  }
  return rows.map((r) => ({
    id: String(r.id),
    status: r.state as Status,
    updatedAt: r.updatedAt ?? undefined,
    appliedDate: r.appliedDate ?? undefined,
    interviews: (kindsByPosting.get(r.id) ?? []).map((kind) => ({ kind })),
  }));
}

// A posting at this company was just rejected — decide whether that earns a cooldown and store it.
// Called from the three places a rejection can land: the UI patch, an approved inbox-sync change,
// and an inbox-sync insert of a req you never tracked.
//
// Scoped to the posting that TRIGGERED it, not to the company's whole history, so a cooldown you
// cleared by hand stays cleared until a genuinely new qualifying rejection arrives.
export function applyRejectionCooldown(companyId: number, postingId: number, at = today()): string | null {
  const co = db.select().from(companies).where(eq(companies.id, companyId)).get();
  if (!co) return null;
  const all = postingsFor(co, postingId);
  const trigger = all.find((p) => p.id === String(postingId));
  if (!trigger) return co.cooldownUntil;
  return applyDecision(co, cooldownFromRejection(trigger, all, at));
}

// What this company's cooldown WOULD be from everything on record. Not part of the write path (see
// above) — it's here for backfilling companies that were rejected before this feature existed.
export function backfillCompanyCooldown(companyId: number, at = today()): string | null {
  const co = db.select().from(companies).where(eq(companies.id, companyId)).get();
  if (!co) return null;
  return applyDecision(co, companyCooldown(postingsFor(co), at));
}

// The manual control: an explicit date, or null to clear. Junk is rejected rather than stored,
// since an unparseable value would silently read as "not cooling" forever.
export function setCompanyCooldown(
  companyId: number,
  until: string | null,
  meta: { actor?: string; source?: string } = {},
): string | null {
  const co = db.select().from(companies).where(eq(companies.id, companyId)).get();
  if (!co) return null;
  if (until !== null && !isValidCooldownDate(until)) return co.cooldownUntil;
  return writeCooldown(co, until, "set by hand", meta);
}
