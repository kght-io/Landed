import test from "node:test";
import assert from "node:assert/strict";
import { shouldRotate, planShifts, ROTATE_THRESHOLD_BYTES, ROTATE_KEEP } from "@landed/backend/logs/rotate";

// Rotation for the launchd logs, which have no rotation of their own and have already filled the
// disk once (115 ENOSPC errors in launchd-jobhunt.err.log). The risky part is the generation
// shuffle: rename the OLDEST first, or each rename clobbers the generation above it.

test("only rotates once a log is over the threshold", () => {
  assert.equal(shouldRotate(ROTATE_THRESHOLD_BYTES - 1), false);
  assert.equal(shouldRotate(ROTATE_THRESHOLD_BYTES), true);
  assert.equal(shouldRotate(ROTATE_THRESHOLD_BYTES * 4), true);
  assert.equal(shouldRotate(0), false);
});

test("the threshold leaves plenty of headroom under a full disk", () => {
  assert.ok(ROTATE_THRESHOLD_BYTES >= 5_000_000 && ROTATE_THRESHOLD_BYTES <= 100_000_000);
});

test("first rotation just moves the live log aside", () => {
  const { shifts, deletes } = planShifts("app.log", [], ROTATE_KEEP);
  assert.deepEqual(shifts, [{ from: "app.log", to: "app.log.1.gz" }]);
  assert.deepEqual(deletes, []);
});

test("existing generations shift OLDEST-FIRST so nothing is clobbered", () => {
  const { shifts } = planShifts("app.log", ["app.log.1.gz", "app.log.2.gz"], 3);
  // .2 must move to .3 BEFORE .1 moves to .2, else .2 is overwritten and a generation is lost.
  assert.deepEqual(shifts, [
    { from: "app.log.2.gz", to: "app.log.3.gz" },
    { from: "app.log.1.gz", to: "app.log.2.gz" },
    { from: "app.log", to: "app.log.1.gz" },
  ]);
});

test("generations past `keep` are deleted, not shifted off into infinity", () => {
  const { shifts, deletes } = planShifts("app.log", ["app.log.1.gz", "app.log.2.gz", "app.log.3.gz"], 3);
  assert.deepEqual(deletes, ["app.log.3.gz"]); // would become .4 — beyond keep
  assert.deepEqual(shifts, [
    { from: "app.log.2.gz", to: "app.log.3.gz" },
    { from: "app.log.1.gz", to: "app.log.2.gz" },
    { from: "app.log", to: "app.log.1.gz" },
  ]);
});

test("a gap in the generations doesn't stall the shift", () => {
  // .1 was deleted by hand — .2 should still age out normally and the live log still rotates in.
  const { shifts, deletes } = planShifts("app.log", ["app.log.2.gz"], 3);
  assert.deepEqual(deletes, []);
  assert.deepEqual(shifts, [
    { from: "app.log.2.gz", to: "app.log.3.gz" },
    { from: "app.log", to: "app.log.1.gz" },
  ]);
});

test("unrelated files in the directory are never touched", () => {
  const { shifts, deletes } = planShifts("app.log", ["other.log.1.gz", "app.log.notanumber.gz"], 3);
  assert.deepEqual(deletes, []);
  assert.deepEqual(shifts, [{ from: "app.log", to: "app.log.1.gz" }]);
});
