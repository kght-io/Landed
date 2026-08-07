import test from "node:test";
import assert from "node:assert/strict";
import {
  applyClosedFilter, closedFilterCounts, resolveClosedFilter, NO_CLOSED_FILTER,
} from "@landed/shared/pipeline/closed-filter";
import type { Posting, Status } from "@landed/shared/types";

let n = 0;
const p = (status: Status, interviewed = false): Posting => ({
  id: String(++n), company: "Acme", tier: "tier3", role: "Engineer", status, interviewed,
});

// A Closed step shaped like the real one: mostly rejections, some of them after a real loop.
const REJ_INT = p("rejected", true);
const REJ_INT2 = p("rejected", true);
const REJ = p("rejected");
const GHOST = p("ghost");
const SKIPPED = p("company_skipped");
const BASE = [REJ_INT, REJ_INT2, REJ, GHOST, SKIPPED];

test("no filter → everything", () => {
  assert.deepEqual(applyClosedFilter(BASE, NO_CLOSED_FILTER), BASE);
});

test("status and interviewed COMBINE — this is the point of the feature", () => {
  const got = applyClosedFilter(BASE, { status: "rejected", interviewed: true });
  assert.deepEqual(got, [REJ_INT, REJ_INT2]);
});

test("interviewed alone spans every closed status", () => {
  const withGhostInt = [...BASE, p("ghost", true)];
  const got = applyClosedFilter(withGhostInt, { status: "all", interviewed: true });
  assert.equal(got.length, 3);
  assert.ok(got.every((x) => x.interviewed));
});

test("status alone ignores whether you interviewed", () => {
  assert.deepEqual(applyClosedFilter(BASE, { status: "rejected", interviewed: false }), [REJ_INT, REJ_INT2, REJ]);
});

test("a status that isn't present heals back to all, keeping the interviewed toggle", () => {
  assert.deepEqual(resolveClosedFilter(BASE, { status: "offer", interviewed: true }), { status: "all", interviewed: true });
});

test("interviewed heals off when the chosen status has none — status wins", () => {
  assert.deepEqual(resolveClosedFilter(BASE, { status: "ghost", interviewed: true }), { status: "ghost", interviewed: false });
});

test("both axes heal when neither can be satisfied", () => {
  const noInterviews = [p("ghost"), p("expired")];
  assert.deepEqual(resolveClosedFilter(noInterviews, { status: "rejected", interviewed: true }), NO_CLOSED_FILTER);
});

test("a resolved filter never yields an empty table", () => {
  const wants: { status: Status | "all"; interviewed: boolean }[] = [
    { status: "all", interviewed: false }, { status: "all", interviewed: true },
    { status: "rejected", interviewed: true }, { status: "ghost", interviewed: true },
    { status: "offer", interviewed: true }, { status: "company_skipped", interviewed: false },
  ];
  for (const want of wants) {
    const eff = resolveClosedFilter(BASE, want);
    assert.ok(applyClosedFilter(BASE, eff).length > 0, `${JSON.stringify(want)} → ${JSON.stringify(eff)} emptied the table`);
  }
});

test("counts are faceted — each pill says what clicking it would give you", () => {
  // Interviewed is ON: the status pills must count only interviewed rows, or "Rejected (3)" would
  // promise three rows and deliver two.
  const on = closedFilterCounts(BASE, { status: "rejected", interviewed: true });
  assert.equal(on.all, 5);
  assert.equal(on.byStatus.rejected, 2);
  assert.equal(on.byStatus.ghost, undefined);
  assert.equal(on.interviewed, 2);
  // Interviewed OFF: status pills count everything; the interviewed pill counts within the status.
  const off = closedFilterCounts(BASE, { status: "rejected", interviewed: false });
  assert.equal(off.byStatus.rejected, 3);
  assert.equal(off.byStatus.ghost, 1);
  assert.equal(off.interviewed, 2);
  // …and within a status with no interviews, the pill reads 0 rather than the global figure.
  assert.equal(closedFilterCounts(BASE, { status: "ghost", interviewed: false }).interviewed, 0);
});

test("an empty step doesn't throw", () => {
  assert.deepEqual(resolveClosedFilter([], { status: "rejected", interviewed: true }), NO_CLOSED_FILTER);
  assert.deepEqual(applyClosedFilter([], NO_CLOSED_FILTER), []);
  assert.deepEqual(closedFilterCounts([], NO_CLOSED_FILTER), { all: 0, byStatus: {}, interviewed: 0 });
});
