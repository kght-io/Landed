import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { jobs } from "../../db/schema";
import { getConfig, INBOX_SYNCED_KEY } from "../../db/config-store";
import { createJob } from "../queue";

// inbox-sync: the daily/manual Gmail sweep and the search window it carries.
//
// Part of the jobs/ split: this file owns WHEN a job of this kind is queued (and what it carries).
// The type-agnostic lifecycle — claim, lease, reap, ingest — lives in ../queue.ts.

// Canonical home is db/config-store — a leaf both the queue and the job registry can import without
// a cycle. Re-exported here so existing callers (db/ops.ts, tests) keep their import path.
export { INBOX_SYNCED_KEY } from "../../db/config-store";
export const inboxLastSynced = () => getConfig(INBOX_SYNCED_KEY);

// The `after:` operand, as a UNIX EPOCH IN SECONDS (`after:1784953419`) rather than a calendar date.
// Gmail reads `after:2026/07/29` in the ACCOUNT's local timezone but reads an epoch as an absolute
// instant — and the watermark IS an absolute instant, so the epoch form is the one that round-trips
// without a timezone gap. Verified against the live mailbox through IMAP X-GM-RAW (the transport
// backing searchGmail): it honours an epoch to the second, while the date form only resolves to a
// day. Do NOT use `newer_than:Nd` here — Gmail anchors "ago" at QUERY time, but a queued job can be
// claimed (and reaped/requeued) hours later, so a relative window silently slides off the mail it
// was sized to cover.
const gmailAfter = (ms: number) => String(Math.floor(ms / 1000));
// No watermark yet → the playbook's documented cold start (see instructions/inbox-sync.md).
const INBOX_COLD_START_DAYS = 120;
// Why the window still starts slightly BEFORE the watermark. Only one reason survives the switch to
// epochs: the watermark is stamped when the result is INGESTED (the inbox-sync def's afterIngest),
// not at the newest message the agent actually read — so the tail of every window is mail nobody has
// definitely looked at. That gap is minutes, so an hour covers it; the old date form needed a whole
// day, purely to absorb the timezone slop that epochs remove. Re-scanning is cheap either way: a
// re-proposed change dedups by signature in createPendingChange, and an approved one plans empty.
const INBOX_OVERLAP_MS = 60 * 60 * 1000;

// The `after:` operand an inbox-sync should search from — the watermark backed off by the overlap,
// or the cold-start window when there's no watermark (or an unparseable one). `nowMs` is injectable
// so the window is directly testable.
export function inboxSyncSince(nowMs = Date.now()): string {
  const t = Date.parse(inboxLastSynced() ?? "");
  return gmailAfter(
    Number.isFinite(t) ? t - INBOX_OVERLAP_MS : nowMs - INBOX_COLD_START_DAYS * 86_400_000,
  );
}

// Queue an inbox-sync WITH its search window. Every enqueue path goes through here: without
// `params.since` the task string falls back to the literal "the last sync", and the playbook's
// window-sizing strategy has no date to size against — the agent then guesses its own window.
export function enqueueInboxSync(opts: { id?: string; createdBy?: string | null } = {}): string {
  return createJob({ ...opts, type: "inbox-sync", params: { since: inboxSyncSince() } });
}

// Queue the daily auto inbox-sync, idempotently. `id` is the caller's day-keyed id
// (`dailySyncJobId` → `inbox-sync-daily-YYYY-MM-DD`), which makes "once per day" a DB fact rather
// than a client-state hope: the UI timer can fire repeatedly — a double-invoked effect, a second
// tab, a tick inside the 25s queue-poll gap — and only the first one queues.
//
// Two guards, both needed:
//  - the day's row already exists in ANY status → stand down. Not a `createJob` upsert: that would
//    bounce an already-INGESTED row back to `queued` and re-run the day's sync.
//  - some other inbox-sync is outstanding (a manual click, "Update interview status") → stand down
//    rather than stack a second sync of the same mail.
// Returns whether it actually queued.
export function enqueueDailyInboxSync(id: string): boolean {
  if (db.select().from(jobs).where(eq(jobs.id, id)).get()) return false; // today's slot already handled
  const outstanding = !!db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, "inbox-sync"), inArray(jobs.status, ["queued", "wip"])))
    .get();
  if (outstanding) return false;
  enqueueInboxSync({ id, createdBy: "You" });
  return true;
}
