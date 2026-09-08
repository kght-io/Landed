import { eq } from "drizzle-orm";
import { db } from "../../db";
import { companies } from "../../db/schema";
import { canonical } from "@landed/shared/agents/canonical";
import { createJob, listJobs } from "../queue";
import { isCompanyCooling } from "../../db/cooldown";
import { hasLadderMap, coerceLadderMap } from "@landed/shared/config/ladder";
import { queueLadderMap } from "./leveling-map";
import type { CompanyRow } from "../../db/schema";

// Can the level gate actually judge this company? It reads `companies.ladder_map`; an unreadable or
// degraded map is the same as none, because the gate would otherwise treat it as a real answer.
function isMapped(co: CompanyRow): boolean {
  if (!co.ladderMap) return false;
  try {
    return hasLadderMap(coerceLadderMap(JSON.parse(co.ladderMap)));
  } catch {
    return false;
  }
}

// watchlist-scan: queueing board scrapes for watchlisted companies.
//
// Part of the jobs/ split: this file owns WHEN a job of this kind is queued (and what it carries).
// The type-agnostic lifecycle — claim, lease, reap, ingest — lives in ../queue.ts.

// Queue a `watchlist-scan` job per watchlisted company not scraped in the last `staleDays` (or
// never), skipping any that already have an outstanding (queued/wip) scan job. Deterministic id per
// company → idempotent: re-clicking "Scrape watchlist" won't duplicate or disturb in-flight scans.
// This is the ONLY way watchlist scans enter the queue (the agent no longer self-initiates them).
// Scanning a company whose rungs we can't read wastes the whole point of the glance: the level gate
// has nothing to judge against, so it can't drop anything, and the entire board lands in triage
// unlevelled with no sign that anything was missing.
//
// So an unmapped company is a HAND-OFF, not a skip: it's queued for mapping, and the `leveling-map`
// job's afterIngest queues the scan the moment its map lands (see jobs/registry.ts). One click gets
// you all the way through — you never have to come back and press it again.
export function queueStaleWatchlistScans(staleDays = 3): { queued: number; skipped: number; cooling: number; mapping: number; total: number } {
  const cutoff = Date.now() - staleDays * 86_400_000;
  const watched = db.select().from(companies).where(eq(companies.watchlist, true)).all()
    .filter((co) => !co.lastScrapedAt || new Date(co.lastScrapedAt).getTime() < cutoff);
  // A company cooling off after rejecting you isn't scanned at all — the point of the cooldown is
  // that its jobs stop arriving, and not scanning is also where the agent tokens are saved.
  // Counted separately from `skipped` (already in flight) so the UI can say which is which.
  const stale = watched.filter((co) => !isCompanyCooling(co));
  const cooling = watched.length - stale.length;
  const statusById = new Map(listJobs().map((j) => [j.id, j.status]));
  let queued = 0, skipped = 0, mapping = 0;
  for (const co of stale) {
    // Map first. `queueLadderMap` is itself idempotent, so a company already being mapped isn't
    // re-queued; either way it isn't scanned until the map lands.
    if (!isMapped(co)) {
      // The map's completion chains into the scan, so this isn't a lost cycle.
      if (queueLadderMap(co.name).status === "queued") mapping++;
      continue;
    }
    const jid = `watchlist-scan-${co.id}`;
    const st = statusById.get(jid);
    if (st === "queued" || st === "wip") { skipped++; continue; } // already in flight — leave it
    createJob({ id: jid, type: "watchlist-scan", createdBy: "You", params: { company: co.name } });
    queued++;
  }
  return { queued, skipped, cooling, mapping, total: stale.length };
}

// Has this company been scanned SINCE its ladder was made? "Never scanned" is not the right test:
// almost every company had already been scanned under the old, unlevelled rules, so keying on that
// left 48 freshly-mapped companies un-chained — precisely the scans the map exists to improve.
// A map with no `checkedAt` is treated as newer, since we can't show the scan already had it.
function scanPredatesMap(co: CompanyRow): boolean {
  if (!co.lastScrapedAt) return true; // never scanned → definitely due
  try {
    const map = coerceLadderMap(JSON.parse(co.ladderMap ?? "null"));
    return !map?.checkedAt || map.checkedAt > co.lastScrapedAt;
  } catch {
    return false; // unreadable — isMapped() already rejects it
  }
}

// The state machine's edge, as a RECONCILER rather than an event: any watchlisted company that now
// has a readable ladder but has never been scanned gets its scan queued.
//
// A sweep rather than an afterIngest hook for two reasons. Structurally, the registry can't depend on
// ./enqueue/* without closing a cycle. Practically, a sweep is the stronger guarantee: an event fires
// once and is lost if anything goes wrong, while this re-asserts itself on every tick — the same
// reasoning as reconcileFitQueue / reconcileTailoringQueue next to it in ./sweep.ts.
//
// So "map, then scan" needs no second button press: the map lands, the next sweep queues the scan.
export function reconcileMappedScans(): number {
  const ready = db.select().from(companies).where(eq(companies.watchlist, true)).all()
    .filter((co) => isMapped(co) && !isCompanyCooling(co) && scanPredatesMap(co));
  const statusById = new Map(listJobs().map((j) => [j.id, j.status]));
  let queued = 0;
  for (const co of ready) {
    const jid = `watchlist-scan-${co.id}`;
    const st = statusById.get(jid);
    if (st === "queued" || st === "wip") continue;
    createJob({ id: jid, type: "watchlist-scan", createdBy: "You", params: { company: co.name } });
    queued++;
  }
  return queued;
}

// Queue a `watchlist-scan` job for ONE watchlisted company on demand (the per-row "Scan now"
// button) — same deterministic id (`watchlist-scan-<id>`) and idempotency as the bulk path, so it
// dedups against an in-flight scan and won't duplicate a company already queued by "Scrape watchlist".
// Unlike the bulk sweep, staleness is ignored — an explicit per-company scan always queues.
export function queueWatchlistScan(name: string): { status: "queued" | "in-flight" | "not-found" | "mapping"; company?: string } {
  const key = canonical(name)?.key;
  const co = key ? db.select().from(companies).where(eq(companies.watchlist, true)).all().find((c) => canonical(c.name)?.key === key) : undefined;
  if (!co) return { status: "not-found" };
  // Same precondition as the sweep, and for the same reason — scanning without a ladder is what
  // we're preventing, whoever asked for it. The scan follows automatically when the map lands, so
  // `mapping` describes a hop in progress, not a request that was dropped.
  if (!isMapped(co)) {
    queueLadderMap(co.name);
    return { status: "mapping", company: co.name };
  }
  const jid = `watchlist-scan-${co.id}`;
  const st = new Map(listJobs().map((j) => [j.id, j.status])).get(jid);
  if (st === "queued" || st === "wip") return { status: "in-flight", company: co.name };
  createJob({ id: jid, type: "watchlist-scan", createdBy: "You", params: { company: co.name } });
  return { status: "queued", company: co.name };
}
