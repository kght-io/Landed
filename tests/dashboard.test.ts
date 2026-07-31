import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, db, seedApp } from "./helpers";
import { prepAttempts, prepQuestions } from "@landed/backend/db/schema";
import { dashboardStats } from "@landed/backend/db/dashboard";

// A fixed "now" so the week/month axes are deterministic regardless of when the suite runs.
// 2026-07-21 is a Tuesday → its Monday-anchored week starts 2026-07-20; its month is 2026-07.
const NOW = new Date("2026-07-21T12:00:00Z");

beforeEach(() => {
  reset();
  db.delete(prepAttempts).run();
  db.delete(prepQuestions).run();
});

const seedQuestion = (id: string, track: "coding" | "system_design") =>
  db.insert(prepQuestions).values({ id, track, name: id }).run();
const seedAttempt = (questionId: string, attemptedAt: string, status: "solved" | "partial" | "failed" = "solved") =>
  db.insert(prepAttempts).values({ questionId, attemptedAt, status }).run();

const bucket = <T extends { key: string }>(arr: T[], key: string): T => {
  const b = arr.find((p) => p.key === key);
  assert.ok(b, `bucket ${key} exists in [${arr.map((p) => p.key).join(", ")}]`);
  return b!;
};

test("applications series buckets by appliedDate for both week and month ranges", () => {
  seedApp({ company: "A", appliedDate: "2026-07-20", status: "applied" }); // this week (Mon 07-20)
  seedApp({ company: "B", appliedDate: "2026-07-15", status: "rejected" }); // week Mon 07-13 (still counts — was applied)
  seedApp({ company: "C", appliedDate: "2026-06-10", status: "applied" }); // week Mon 06-08, month 2026-06
  // Has an appliedDate but never reached an applied stage → must NOT be counted.
  seedApp({ company: "D", appliedDate: "2026-07-20", status: "assessed" });

  const d = dashboardStats(NOW);
  assert.equal(d.applications.week.length, 12);
  assert.equal(d.applications.month.length, 12);
  assert.equal(bucket(d.applications.week, "2026-07-20").count, 1, "the assessed posting is excluded");
  assert.equal(bucket(d.applications.week, "2026-07-13").count, 1, "a rejected posting still counts as an application made");
  assert.equal(bucket(d.applications.week, "2026-06-08").count, 1);
  assert.equal(bucket(d.applications.month, "2026-07").count, 2, "two real applications land in July");
  assert.equal(bucket(d.applications.month, "2026-06").count, 1);
});

test("prep series tracks leetcode-solved and system-design-practiced as two lines", () => {
  seedQuestion("lc-1", "coding");
  seedQuestion("lc-2", "coding");
  seedQuestion("sd-1", "system_design");
  seedAttempt("lc-1", "2026-07-20T09:00:00Z", "solved"); // counts as leetcode
  seedAttempt("lc-2", "2026-07-20T10:00:00Z", "failed"); // NOT solved → not counted
  seedAttempt("sd-1", "2026-07-20T11:00:00Z", "solved"); // counts as system design (practiced)

  const d = dashboardStats(NOW);
  const wk = bucket(d.prep.week, "2026-07-20");
  assert.equal(wk.leetcode, 1, "only the solved coding attempt counts");
  assert.equal(wk.systemDesign, 1);
  const mo = bucket(d.prep.month, "2026-07");
  assert.equal(mo.leetcode, 1);
  assert.equal(mo.systemDesign, 1);
});
