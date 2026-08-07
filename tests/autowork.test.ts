import test from "node:test";
import assert from "node:assert/strict";
import { autoWorkPlan, AUTO_WORK_THRESHOLD } from "@landed/shared/agents/autowork";

const none = () => false;

test("disabled → nothing starts or notifies, even with queued work", () => {
  const plan = autoWorkPlan({ enabled: false, byType: { fit: 3, tailoring: 20 }, running: none, held: none });
  assert.deepEqual(plan, { start: [], notify: [] });
});

test("a small batch auto-starts silently", () => {
  const plan = autoWorkPlan({ enabled: true, byType: { fit: 3 }, running: none, held: none });
  assert.deepEqual(plan, { start: ["fit"], notify: [] });
});

test("exactly at the threshold is silent; one over still starts, but says so", () => {
  const at = autoWorkPlan({ enabled: true, byType: { fit: AUTO_WORK_THRESHOLD }, running: none, held: none });
  assert.deepEqual(at, { start: ["fit"], notify: [] });
  const over = autoWorkPlan({ enabled: true, byType: { fit: AUTO_WORK_THRESHOLD + 1 }, running: none, held: none });
  assert.deepEqual(over, { start: ["fit"], notify: ["fit"] });
});

test("a type already being drained is not re-started — but a big backlog still notifies", () => {
  const small = autoWorkPlan({ enabled: true, byType: { fit: 2 }, running: (t) => t === "fit", held: none });
  assert.deepEqual(small, { start: [], notify: [] });
  const big = autoWorkPlan({ enabled: true, byType: { fit: 12 }, running: (t) => t === "fit", held: none });
  assert.deepEqual(big, { start: [], notify: ["fit"] });
});

test("a held agent is left alone entirely — no start, no notice", () => {
  const small = autoWorkPlan({ enabled: true, byType: { fit: 2 }, running: none, held: (t) => t === "fit" });
  assert.deepEqual(small, { start: [], notify: [] });
  const big = autoWorkPlan({ enabled: true, byType: { fit: 12 }, running: none, held: (t) => t === "fit" });
  assert.deepEqual(big, { start: [], notify: [] });
});

test("zero-count types are skipped", () => {
  const plan = autoWorkPlan({ enabled: true, byType: { fit: 0 }, running: none, held: none });
  assert.deepEqual(plan, { start: [], notify: [] });
});

test("a long queue that did NOT just grow (e.g. present on load) works without a notice", () => {
  const plan = autoWorkPlan({ enabled: true, byType: { fit: 12 }, running: none, held: none, grew: () => false });
  assert.deepEqual(plan, { start: ["fit"], notify: [] });
});

test("a long queue notifies once it grows (a new item added)", () => {
  const plan = autoWorkPlan({ enabled: true, byType: { fit: 12 }, running: none, held: none, grew: (t) => t === "fit" });
  assert.deepEqual(plan, { start: ["fit"], notify: ["fit"] });
});

test("an acted-on type never notifies again — it just works", () => {
  const plan = autoWorkPlan({
    enabled: true,
    byType: { fit: 12 },
    running: none,
    held: none,
    grew: () => true,
    ignored: (t) => t === "fit",
  });
  assert.deepEqual(plan, { start: ["fit"], notify: [] });
});

test("acting on one type doesn't silence the others", () => {
  const plan = autoWorkPlan({
    enabled: true,
    byType: { fit: 12, tailoring: 9 },
    running: none,
    held: none,
    ignored: (t) => t === "fit",
  });
  assert.deepEqual(plan, { start: ["fit", "tailoring"], notify: ["tailoring"] });
});

test("ignore does not override the off switch, a live run, or a held agent", () => {
  const ignored = () => true;
  assert.deepEqual(autoWorkPlan({ enabled: false, byType: { fit: 12 }, running: none, held: none, ignored }), { start: [], notify: [] });
  assert.deepEqual(autoWorkPlan({ enabled: true, byType: { fit: 12 }, running: () => true, held: none, ignored }), { start: [], notify: [] });
  assert.deepEqual(autoWorkPlan({ enabled: true, byType: { fit: 12 }, running: none, held: () => true, ignored }), { start: [], notify: [] });
});

test("mixed queue: everything starts, only the big one speaks up, sorted + stable", () => {
  const plan = autoWorkPlan({
    enabled: true,
    byType: { tailoring: 10, fit: 2, "inbox-sync": 1 },
    running: none,
    held: none,
  });
  assert.deepEqual(plan, { start: ["fit", "inbox-sync", "tailoring"], notify: ["tailoring"] });
});
