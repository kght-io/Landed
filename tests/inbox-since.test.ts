import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset } from "./helpers";
import { inboxSyncSince, enqueueInboxSync, enqueueDailyInboxSync, updateInterviewStatus, listJobs } from "@landed/backend/jobs/store";
import { setConfig } from "@landed/backend/db/config-store";
import { jobDef } from "@landed/backend/jobs/registry";

beforeEach(() => reset());

const DAY = 86_400_000;
const HOUR = 3_600_000;
const epoch = (ms: number) => String(Math.floor(ms / 1000));

// --- the window itself -------------------------------------------------------------------------

// `after:` is emitted as a UNIX EPOCH (seconds), not a YYYY/MM/DD date. Gmail reads a calendar date
// in the ACCOUNT's local timezone but reads an epoch as an absolute instant, so the epoch form has
// no timezone gap to paper over — verified against the live mailbox through IMAP X-GM-RAW, which
// honours it to the second.
test("cold start (no watermark) → a 120-day window, as an epoch", () => {
  const now = Date.parse("2026-07-31T09:00:00.000Z");
  assert.equal(inboxSyncSince(now), epoch(now - 120 * DAY));
});

// The only remaining reason to overlap: the watermark is stamped when the result is INGESTED, not at
// the newest message the agent actually read, so the tail of each window is mail nobody has
// definitely looked at. That gap is minutes, so an hour covers it — where the date form needed a
// whole day. Re-scanning is cheap: a re-proposed change dedups by signature in createPendingChange.
test("with a watermark → one HOUR before it (not a whole day)", () => {
  setConfig("inbox_last_synced", "2026-07-30T23:40:00.000Z");
  const want = Date.parse("2026-07-30T23:40:00.000Z") - HOUR;
  assert.equal(inboxSyncSince(Date.parse("2026-07-31T09:00:00.000Z")), epoch(want));
});

test("a garbage watermark degrades to the cold-start window rather than NaN", () => {
  setConfig("inbox_last_synced", "not a date");
  const now = Date.parse("2026-07-31T09:00:00.000Z");
  assert.equal(inboxSyncSince(now), epoch(now - 120 * DAY));
});

test("the window is a bare integer — no punctuation Gmail would read as a date", () => {
  setConfig("inbox_last_synced", "2026-07-30T23:40:00.000Z");
  assert.match(inboxSyncSince(Date.parse("2026-07-31T09:00:00.000Z")), /^\d+$/);
});

// --- the window reaches the agent --------------------------------------------------------------

const sinceOf = (id: string) => listJobs().find((j) => j.id === id)?.params?.since;
const taskOf = (id: string) => listJobs().find((j) => j.id === id)?.task ?? "";
// The window these enqueue paths should stamp, given the watermark each test sets below.
const WATERMARK = "2026-07-30T23:40:00.000Z";
const SINCE = epoch(Date.parse(WATERMARK) - HOUR);

test("enqueueInboxSync stamps params.since and names that date in the task", () => {
  setConfig("inbox_last_synced", "2026-07-30T23:40:00.000Z");
  const id = enqueueInboxSync({ createdBy: "You" });

  assert.equal(sinceOf(id), SINCE);
  assert.match(taskOf(id), new RegExp(SINCE));
  // The regression: without params.since the task fell back to this string and the agent had to
  // guess its own window, so the playbook's window-sizing strategy never applied.
  assert.doesNotMatch(taskOf(id), /the last sync/);
});

test("the daily auto-sync carries a window too", () => {
  setConfig("inbox_last_synced", "2026-07-30T23:40:00.000Z");
  const id = "inbox-sync-daily-2026-07-31";
  assert.equal(enqueueDailyInboxSync(id), true);

  assert.equal(sinceOf(id), SINCE);
  assert.doesNotMatch(taskOf(id), /the last sync/);
  // The idempotence guard is untouched: the day's slot is claimed.
  assert.equal(enqueueDailyInboxSync(id), false);
});

test("the 'update interview status' fan-out carries a window too", () => {
  setConfig("inbox_last_synced", "2026-07-30T23:40:00.000Z");
  assert.equal(updateInterviewStatus().inboxSync, true);

  const sync = listJobs().find((j) => j.type === "inbox-sync");
  assert.equal(sync?.params?.since, SINCE);
  assert.doesNotMatch(sync?.task ?? "", /the last sync/);
});

test("an explicit since still wins — a caller can widen the window itself", () => {
  assert.match(jobDef("inbox-sync")!.buildTask({ since: "2026/01/01" }), /2026\/01\/01/);
});
