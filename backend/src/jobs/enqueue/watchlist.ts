import { eq } from "drizzle-orm";
import { db } from "../../db";
import { companies } from "../../db/schema";
import { canonical } from "@landed/shared/agents/canonical";
import { createJob, listJobs } from "../queue";
import { isCompanyCooling } from "../../db/cooldown";

// watchlist-scan: queueing board scrapes for watchlisted companies.
//
// Part of the jobs/ split: this file owns WHEN a job of this kind is queued (and what it carries).
// The type-agnostic lifecycle — claim, lease, reap, ingest — lives in ../queue.ts.

// Queue a `watchlist-scan` job per watchlisted company not scraped in the last `staleDays` (or
// never), skipping any that already have an outstanding (queued/wip) scan job. Deterministic id per
// company → idempotent: re-clicking "Scrape watchlist" won't duplicate or disturb in-flight scans.
// This is the ONLY way watchlist scans enter the queue (the agent no longer self-initiates them).
export function queueStaleWatchlistScans(staleDays = 3): { queued: number; skipped: number; cooling: number; total: number } {
  const cutoff = Date.now() - staleDays * 86_400_000;
  const watched = db.select().from(companies).where(eq(companies.watchlist, true)).all()
    .filter((co) => !co.lastScrapedAt || new Date(co.lastScrapedAt).getTime() < cutoff);
  // A company cooling off after rejecting you isn't scanned at all — the point of the cooldown is
  // that its jobs stop arriving, and not scanning is also where the agent tokens are saved.
  // Counted separately from `skipped` (already in flight) so the UI can say which is which.
  const stale = watched.filter((co) => !isCompanyCooling(co));
  const cooling = watched.length - stale.length;
  const statusById = new Map(listJobs().map((j) => [j.id, j.status]));
  let queued = 0, skipped = 0;
  for (const co of stale) {
    const jid = `watchlist-scan-${co.id}`;
    const st = statusById.get(jid);
    if (st === "queued" || st === "wip") { skipped++; continue; } // already in flight — leave it
    createJob({ id: jid, type: "watchlist-scan", createdBy: "You", params: { company: co.name } });
    queued++;
  }
  return { queued, skipped, cooling, total: stale.length };
}

// Queue a `watchlist-scan` job for ONE watchlisted company on demand (the per-row "Scan now"
// button) — same deterministic id (`watchlist-scan-<id>`) and idempotency as the bulk path, so it
// dedups against an in-flight scan and won't duplicate a company already queued by "Scrape watchlist".
// Unlike the bulk sweep, staleness is ignored — an explicit per-company scan always queues.
export function queueWatchlistScan(name: string): { status: "queued" | "in-flight" | "not-found"; company?: string } {
  const key = canonical(name)?.key;
  const co = key ? db.select().from(companies).where(eq(companies.watchlist, true)).all().find((c) => canonical(c.name)?.key === key) : undefined;
  if (!co) return { status: "not-found" };
  const jid = `watchlist-scan-${co.id}`;
  const st = new Map(listJobs().map((j) => [j.id, j.status])).get(jid);
  if (st === "queued" || st === "wip") return { status: "in-flight", company: co.name };
  createJob({ id: jid, type: "watchlist-scan", createdBy: "You", params: { company: co.name } });
  return { status: "queued", company: co.name };
}
