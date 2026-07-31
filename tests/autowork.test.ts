import test from "node:test";
import assert from "node:assert/strict";
import { autoWorkPlan, AUTO_WORK_THRESHOLD } from "@landed/shared/agents/autowork";

const none = () => false;

test("disabled → nothing starts or confirms, even with queued work", () => {
  const plan = autoWorkPlan({ enabled: false, byType: { fit: 3, tailoring: 20 }, running: none, held: none });
  assert.deepEqual(plan, { start: [], confirm: [] });
});

test("a small batch (≤ threshold) auto-starts", () => {
  const plan = autoWorkPlan({ enabled: true, byType: { fit: 3 }, running: none, held: none });
  assert.deepEqual(plan, { start: ["fit"], confirm: [] });
});

test("exactly at the threshold still auto-starts; one over gates a confirm", () => {
  const at = autoWorkPlan({ enabled: true, byType: { fit: AUTO_WORK_THRESHOLD }, running: none, held: none });
  assert.deepEqual(at, { start: ["fit"], confirm: [] });
  const over = autoWorkPlan({ enabled: true, byType: { fit: AUTO_WORK_THRESHOLD + 1 }, running: none, held: none });
  assert.deepEqual(over, { start: [], confirm: ["fit"] });
});

test("a type already being drained is skipped (no double-spawn)", () => {
  const plan = autoWorkPlan({ enabled: true, byType: { fit: 2 }, running: (t) => t === "fit", held: none });
  assert.deepEqual(plan, { start: [], confirm: [] });
});

test("a held type is skipped even when its batch is small", () => {
  const plan = autoWorkPlan({ enabled: true, byType: { fit: 2 }, running: none, held: (t) => t === "fit" });
  assert.deepEqual(plan, { start: [], confirm: [] });
});

test("zero-count types are ignored", () => {
  const plan = autoWorkPlan({ enabled: true, byType: { fit: 0 }, running: none, held: none });
  assert.deepEqual(plan, { start: [], confirm: [] });
});

test("a long queue that did NOT just grow (e.g. present on load) does not confirm", () => {
  const plan = autoWorkPlan({ enabled: true, byType: { fit: 12 }, running: none, held: none, grew: () => false });
  assert.deepEqual(plan, { start: [], confirm: [] });
});

test("a long queue confirms only once it grows (a new item added)", () => {
  const plan = autoWorkPlan({ enabled: true, byType: { fit: 12 }, running: none, held: none, grew: (t) => t === "fit" });
  assert.deepEqual(plan, { start: [], confirm: ["fit"] });
});

test("grew does not gate small batches — they still auto-start on load", () => {
  const plan = autoWorkPlan({ enabled: true, byType: { fit: 3 }, running: none, held: none, grew: () => false });
  assert.deepEqual(plan, { start: ["fit"], confirm: [] });
});

test("mixed queue: small ones start, big ones confirm, sorted + stable", () => {
  const plan = autoWorkPlan({
    enabled: true,
    byType: { tailoring: 10, fit: 2, "inbox-sync": 1 },
    running: none,
    held: none,
  });
  assert.deepEqual(plan, { start: ["fit", "inbox-sync"], confirm: ["tailoring"] });
});
