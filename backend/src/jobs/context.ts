import { inArray } from "drizzle-orm";
import { db } from "../db";
import { postings, companies } from "../db/schema";
import { TRACKER_STAGES } from "@landed/shared/pipeline";
import { inboxLastSynced } from "./enqueue/inbox";

// The read-context the agent works against — for the "What it sees" panel.
export function agentContext() {
  const cos = db.select().from(companies).all();
  return {
    // discovery auto-scans the watchlist only (independent of tier)
    targets: cos.filter((c) => c.watchlist).length,
    tracked: db.select().from(postings).where(inArray(postings.state, [...TRACKER_STAGES])).all().length,
    syncedThrough: inboxLastSynced() ?? null, // full ISO timestamp
  };
}
