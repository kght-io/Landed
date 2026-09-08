import { eq } from "drizzle-orm";
import { db } from "../../db";
import { companies } from "../../db/schema";
import { canonical } from "@landed/shared/agents/canonical";
import { createJob, listJobs } from "../queue";
import { isCompanyCooling } from "../../db/cooldown";
import { coerceLadderMap, hasLadderMap } from "@landed/shared/config/ladder";

// leveling-map (2a of the scan cascade): working out what a company's rungs MEAN.
//
// Per company, once, cached. That split is the whole point — a board can carry 90 postings, and the
// question "is L6 senior here?" has one answer for all of them. Researching it per posting would be
// 90 web searches to learn one fact.
//
// Part of the jobs/ split: this file owns WHEN the job is queued; the lifecycle lives in ../queue.ts.

const parsed = (raw: string | null) => {
  if (!raw) return null;
  try {
    return coerceLadderMap(JSON.parse(raw));
  } catch {
    return null; // unreadable JSON is indistinguishable from absent — re-research it
  }
};

// Queue one job per watchlisted company whose ladder we can't read yet. Deterministic id per company
// → idempotent: re-running never duplicates or disturbs work in flight.
export function queueMissingLadderMaps(): { queued: number; skipped: number; cooling: number; total: number } {
  const watched = db.select().from(companies).where(eq(companies.watchlist, true)).all();
  // Unmapped = no map, or one too degraded to use. A stored map whose rungs all failed coercion is
  // worse than none — the gate would read it as a real answer — so it counts as missing.
  const unmapped = watched.filter((co) => !hasLadderMap(parsed(co.ladderMap)));
  // A company cooling off after rejecting you isn't scanned at all, so its ladder is research nobody
  // will read. Same reasoning as the scan's own cooldown skip, counted separately so a caller can
  // say "not queued because cooling" rather than "already in flight".
  const due = unmapped.filter((co) => !isCompanyCooling(co));
  const cooling = unmapped.length - due.length;

  const statusById = new Map(listJobs().map((j) => [j.id, j.status]));
  let queued = 0;
  let skipped = 0;
  for (const co of due) {
    const jid = `leveling-map-${co.id}`;
    const st = statusById.get(jid);
    if (st === "queued" || st === "wip") {
      skipped++;
      continue;
    }
    createJob({ id: jid, type: "leveling-map", createdBy: "You", params: { company: co.name } });
    queued++;
  }
  return { queued, skipped, cooling, total: due.length };
}

// Research ONE company on demand. Unlike the sweep, an existing map is not a reason to skip: ladders
// get renamed and a stored mapping can simply be wrong, so an explicit re-check has to be possible.
// Idempotency still holds through the shared deterministic id.
export function queueLadderMap(name: string): { status: "queued" | "in-flight" | "not-found"; company?: string } {
  const key = canonical(name)?.key;
  const co = key ? db.select().from(companies).all().find((c) => canonical(c.name)?.key === key) : undefined;
  if (!co) return { status: "not-found" };
  const jid = `leveling-map-${co.id}`;
  const st = new Map(listJobs().map((j) => [j.id, j.status])).get(jid);
  if (st === "queued" || st === "wip") return { status: "in-flight", company: co.name };
  createJob({ id: jid, type: "leveling-map", createdBy: "You", params: { company: co.name } });
  return { status: "queued", company: co.name };
}
