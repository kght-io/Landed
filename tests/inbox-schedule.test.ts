import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldAutoSyncInbox,
  parseSyncTime,
  dailySyncJobId,
  inboxSyncPending,
  INBOX_SYNC_PENDING_GRACE_MS,
  DEFAULT_INBOX_SYNC_TIME,
} from "@landed/shared/config/inbox-schedule";

const at = DEFAULT_INBOX_SYNC_TIME; // 08:00 local

test("never synced, before today's time → not due (app start must not queue)", () => {
  const now = new Date("2026-07-24T07:59:00");
  assert.equal(shouldAutoSyncInbox({ enabled: true, at, lastSynced: null, outstanding: false, now }), false);
});

test("never synced, past today's time → due", () => {
  const now = new Date("2026-07-24T08:00:00");
  assert.equal(shouldAutoSyncInbox({ enabled: true, at, lastSynced: null, outstanding: false, now }), true);
});

test("synced yesterday, before today's time → not due yet", () => {
  const now = new Date("2026-07-24T06:00:00");
  assert.equal(
    shouldAutoSyncInbox({ enabled: true, at, lastSynced: "2026-07-23T08:00:00", outstanding: false, now }),
    false,
  );
});

test("synced yesterday, past today's time → due", () => {
  const now = new Date("2026-07-24T09:00:00");
  assert.equal(
    shouldAutoSyncInbox({ enabled: true, at, lastSynced: "2026-07-23T23:30:00", outstanding: false, now }),
    true,
  );
});

test("synced after today's time → not due again today", () => {
  const now = new Date("2026-07-24T17:00:00");
  assert.equal(
    shouldAutoSyncInbox({ enabled: true, at, lastSynced: "2026-07-24T08:01:00", outstanding: false, now }),
    false,
  );
});

test("synced manually before today's time → still due at the scheduled time", () => {
  const now = new Date("2026-07-24T09:00:00");
  assert.equal(
    shouldAutoSyncInbox({ enabled: true, at, lastSynced: "2026-07-24T07:00:00", outstanding: false, now }),
    true,
  );
});

test("disabled toggle → never due", () => {
  const now = new Date("2026-07-24T09:00:00");
  assert.equal(shouldAutoSyncInbox({ enabled: false, at, lastSynced: null, outstanding: false, now }), false);
});

test("already queued/wip → never stack a second", () => {
  const now = new Date("2026-07-24T09:00:00");
  assert.equal(
    shouldAutoSyncInbox({ enabled: true, at, lastSynced: "2026-07-01T00:00:00", outstanding: true, now }),
    false,
  );
});

test("unparseable watermark → due once past the scheduled time, not before", () => {
  assert.equal(
    shouldAutoSyncInbox({ enabled: true, at, lastSynced: "not-a-date", outstanding: false, now: new Date("2026-07-24T09:00:00") }),
    true,
  );
  assert.equal(
    shouldAutoSyncInbox({ enabled: true, at, lastSynced: "not-a-date", outstanding: false, now: new Date("2026-07-24T02:00:00") }),
    false,
  );
});

test("a custom time is honoured", () => {
  const opts = { enabled: true, at: "21:30", lastSynced: null, outstanding: false };
  assert.equal(shouldAutoSyncInbox({ ...opts, now: new Date("2026-07-24T21:29:00") }), false);
  assert.equal(shouldAutoSyncInbox({ ...opts, now: new Date("2026-07-24T21:30:00") }), true);
});

test("the job id is one per local day, so repeat ticks collapse onto one row", () => {
  const id = dailySyncJobId(new Date("2026-07-24T08:00:00"), at);
  assert.equal(id, "inbox-sync-daily-2026-07-24");
  // Same day, later ticks (and a double-fired effect) → the same id.
  assert.equal(dailySyncJobId(new Date("2026-07-24T08:00:00.373"), at), id);
  assert.equal(dailySyncJobId(new Date("2026-07-24T23:59:00"), at), id);
  // Next day → a new id.
  assert.equal(dailySyncJobId(new Date("2026-07-25T08:00:00"), at), "inbox-sync-daily-2026-07-25");
});

test("the job id keys off the LOCAL day, and pads month/day", () => {
  assert.equal(dailySyncJobId(new Date("2026-01-05T08:30:00"), "08:00"), "inbox-sync-daily-2026-01-05");
});

test("parseSyncTime falls back to the default on junk", () => {
  assert.deepEqual(parseSyncTime("08:00"), { hour: 8, minute: 0 });
  assert.deepEqual(parseSyncTime("21:30"), { hour: 21, minute: 30 });
  assert.deepEqual(parseSyncTime("7:05"), { hour: 7, minute: 5 });
  assert.deepEqual(parseSyncTime(""), { hour: 8, minute: 0 });
  assert.deepEqual(parseSyncTime("nope"), { hour: 8, minute: 0 });
  assert.deepEqual(parseSyncTime("25:00"), { hour: 8, minute: 0 });
  assert.deepEqual(parseSyncTime("08:99"), { hour: 8, minute: 0 });
  assert.deepEqual(parseSyncTime(undefined), { hour: 8, minute: 0 });
});

// --- the Sync-inbox button's optimistic "busy" latch -------------------------------------------
// The latch only exists to cover the click→queue-poll gap. It must never outlive that gap: two
// paths queue nothing observable (a day-keyed POST deduped server-side, a job drained inside the
// poll gap) and a boolean latch with only "the job showed up" as its release wedges the button
// disabled for the rest of the day.

test("an outstanding inbox-sync job keeps the button busy, however old the latch", () => {
  const now = 1_000_000;
  assert.equal(inboxSyncPending({ startedAt: null, outstanding: true, now }), true);
  assert.equal(inboxSyncPending({ startedAt: now - 10 * 60_000, outstanding: true, now }), true);
});

test("a fresh latch reads busy — covers the gap before the queue poll sees the job", () => {
  const now = 1_000_000;
  assert.equal(inboxSyncPending({ startedAt: now, outstanding: false, now }), true);
  assert.equal(inboxSyncPending({ startedAt: now - 1_000, outstanding: false, now }), true);
});

test("the latch expires, so a sync that queued nothing observable can't wedge the button", () => {
  const now = 1_000_000;
  assert.equal(inboxSyncPending({ startedAt: now - INBOX_SYNC_PENDING_GRACE_MS, outstanding: false, now }), false);
  assert.equal(inboxSyncPending({ startedAt: now - 60 * 60_000, outstanding: false, now }), false);
});

test("the grace window outlasts the 25s queue poll, so a real job is never flagged idle mid-gap", () => {
  assert.ok(INBOX_SYNC_PENDING_GRACE_MS > 25_000);
});

test("no latch and nothing outstanding → idle", () => {
  assert.equal(inboxSyncPending({ startedAt: null, outstanding: false, now: 1_000_000 }), false);
});
