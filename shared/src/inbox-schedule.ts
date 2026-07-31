// Decide whether a daily inbox-sync should be auto-queued right now. Pure so the UI timer can call
// it on every tick and the logic stays directly testable (no clock/DOM). "Daily" means once per
// local calendar day *at a scheduled time of day* — the sync fires on the first check at or after
// today's scheduled time, not merely because the app started on a new day.

// Persisted (localStorage) keys. Configured on /settings; the home page reads them to drive the
// auto-queue timer and to show the on/off state inside the Sync-inbox button.
export const INBOX_DAILY_SYNC_KEY = "landed.inbox.dailySync";
export const INBOX_SYNC_TIME_KEY = "landed.inbox.dailySyncTime";

// Local wall-clock time of day, "HH:MM" — matched in local time like the rest of the UI.
export const DEFAULT_INBOX_SYNC_TIME = "08:00";

export function parseSyncTime(at: string | null | undefined): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((at ?? "").trim());
  const hour = m ? Number(m[1]) : NaN;
  const minute = m ? Number(m[2]) : NaN;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    return { hour: 8, minute: 0 }; // junk / unset → the DEFAULT_INBOX_SYNC_TIME hour
  }
  return { hour, minute };
}

// Today's scheduled moment in local time.
function dueAt(now: Date, at: string | null | undefined): Date {
  const { hour, minute } = parseSyncTime(at);
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  return d;
}

// A deterministic job id for the day's scheduled sync: `inbox-sync-daily-YYYY-MM-DD` (local day).
// Every tick on a given day computes the SAME id, so the server can collapse repeat attempts —
// a double-fired effect, a second tab, or a tick landing inside the queue-poll gap — onto one row.
// The client-side "outstanding" guard is React state and can't see any of those.
export function dailySyncJobId(now: Date, at?: string | null): string {
  const d = dueAt(now, at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `inbox-sync-daily-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// How long the Sync-inbox button's optimistic "busy" state may outlive the click that set it.
// It exists only to cover the gap until the 25s queue poll notices the new job, so it needs to
// outlast one poll — and no more.
export const INBOX_SYNC_PENDING_GRACE_MS = 40_000;

// Whether the Sync-inbox button should read (and behave as) busy. An outstanding job is the real
// signal; `startedAt` is the optimistic cover for the poll gap, so a fast double-click can't stack
// two syncs.
//
// The optimistic half MUST expire. Two paths set it and then queue nothing the poll can ever
// observe: the day-keyed daily POST deduped server-side (`queued: false`, no row is created), and
// a job the agent drains inside the poll gap. A latch released only by "the job showed up" stays
// stuck true in both, wedging the button disabled for the rest of the day.
export function inboxSyncPending(opts: {
  startedAt: number | null; // epoch ms of the optimistic click, or null
  outstanding: boolean; // an inbox-sync job is queued/wip right now
  now: number;
}): boolean {
  const { startedAt, outstanding, now } = opts;
  if (outstanding) return true;
  return startedAt !== null && now - startedAt < INBOX_SYNC_PENDING_GRACE_MS;
}

export function shouldAutoSyncInbox(opts: {
  enabled: boolean; // the user's "Daily" toggle
  at?: string | null; // scheduled local time of day, "HH:MM" (defaults to 08:00)
  lastSynced: string | null | undefined; // `inbox_last_synced` watermark (ISO), or null if never
  outstanding: boolean; // an inbox-sync job is already queued/wip — never stack a second
  now: Date;
}): boolean {
  const { enabled, at, lastSynced, outstanding, now } = opts;
  if (!enabled || outstanding) return false;
  const scheduled = dueAt(now, at);
  if (now < scheduled) return false; // today's slot hasn't come around yet — wait, don't fire on start
  const last = lastSynced ? new Date(lastSynced) : null;
  // Never synced (or an unparseable watermark) → due, now that the slot has passed. Otherwise due
  // only if the last sync predates today's slot, so one sync per day and a manual sync at 07:00
  // doesn't cancel the 08:00 run.
  if (!last || Number.isNaN(last.getTime())) return true;
  return last < scheduled;
}
