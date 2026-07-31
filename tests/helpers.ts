// Test helpers. Imported only AFTER ./setup (which configures DB_PATH/ASSET_ROOT),
// so the "@landed/backend/*" imports below bind to the temp DB + temp asset dir.
import { db } from "@landed/backend/db";
import {
  postings, companies, events, interviews, jobs, appConfig, agentRuns, pendingMatches, todos,
} from "@landed/backend/db/schema";
import type { Status } from "@landed/shared/types";
import { listPendingMatches } from "@landed/backend/db/queries";
import { resolvePendingMatch } from "@landed/backend/agents/reconcile";

export { db, postings, companies, events, jobs };

// Wipe all rows between tests. (The job queue + ledger live in the `jobs` table now —
// there are no queue/result/context files to clean.)
export function reset() {
  // Children before parents — interviews FK→postings, postings FK→companies — so FK enforcement
  // (foreign_keys=ON) doesn't reject the deletes once interview rows actually exist.
  for (const t of [interviews, postings, pendingMatches, events, jobs, agentRuns, appConfig, todos]) db.delete(t).run();
  db.delete(companies).run();
}

// Seed a company (created once per name) + one tracker posting (a candidate in a tracker stage);
// returns its id. One unified model now — the tracker lives in `postings`.
export function seedApp(opts: {
  company: string;
  role?: string;
  status?: Status;
  tier?: "tier1" | "tier2" | "tier3";
  interviewed?: boolean;
  appliedDate?: string;
}): number {
  const existing = db.select().from(companies).all().find((c) => c.name === opts.company);
  const companyId =
    existing?.id ??
    db.insert(companies).values({ name: opts.company, tier: opts.tier ?? "tier3" }).returning({ id: companies.id }).get().id;
  // opts.status is the view-level Status; the stored column is `state`. They share names except
  // "discovered" (the view label for a fit-queue posting), whose stored state is "fit_queue".
  const st = opts.status ?? "applied";
  const state = (st === "discovered" ? "fit_queue" : st) as typeof postings.$inferInsert.state;
  return db
    .insert(postings)
    .values({
      companyId,
      title: opts.role ?? "Engineer",
      verdict: "kept",
      state,
      interviewed: opts.interviewed ?? false,
      appliedDate: opts.appliedDate ?? "2026-06-01",
      updatedAt: "2026-06-01",
      scannedAt: "2026-06-01T00:00:00.000Z",
    })
    .returning({ id: postings.id })
    .get().id;
}

// Seed a company (created once per name) + one candidate (discovery side); returns its id.
export function seedCandidate(opts: {
  company: string;
  title?: string;
  url?: string;
  state?: "filtered" | "matched" | "review" | "dismissed" | "fit_queue" | "assessed" | "apply_later" | "tailoring" | "tailored" | "applied";
  verdict?: "kept" | "dropped";
}): number {
  const existing = db.select().from(companies).all().find((c) => c.name === opts.company);
  const companyId =
    existing?.id ??
    db.insert(companies).values({ name: opts.company, tier: "tier3" }).returning({ id: companies.id }).get().id;
  return db
    .insert(postings)
    .values({
      companyId,
      title: opts.title ?? "Engineer",
      url: opts.url ?? null,
      verdict: opts.verdict ?? "kept",
      state: opts.state ?? "fit_queue",
      scannedAt: "2026-06-01T00:00:00.000Z",
    })
    .returning({ id: postings.id })
    .get().id;
}


// An inbox sync doesn't write — it parks every change it derived for you to approve on the Changes
// page (see reconcile's `approval` mode). Tests that care about the RESULT of a sync take the
// approval hop through this: approve each parked change the way the UI's Approve button does
// (apply onto the proposed posting, or create it when the sync proposed a new one).
// Returns how many were approved.
export function approveSyncedChanges(): number {
  const pend = listPendingMatches().filter((p) => p.kind === "change");
  for (const p of pend) {
    const r = p.create
      ? resolvePendingMatch(p.id, "new")
      : resolvePendingMatch(p.id, "apply", p.candidates[0].id);
    if (!r.ok) throw new Error(`approve failed for pending ${p.id}: ${r.error}`);
  }
  return pend.length;
}
