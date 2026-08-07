import test from "node:test";
import assert from "node:assert/strict";
import { companyCooldown, hadRealInterview, COOLDOWN_MONTHS } from "@landed/shared/pipeline/cooldown";
import { reapplyInfo } from "@landed/shared/pipeline/stages";
import type { InterviewKind, Posting, Status } from "@landed/shared/types";

// A minimal Posting, shaped like the real rows this rule reads (see the DB shapes named below).
function p(o: {
  status: Status;
  interviewed?: boolean;
  rounds?: InterviewKind[];
  updatedAt?: string;
  appliedDate?: string;
}): Posting {
  return {
    id: "1",
    company: "Acme",
    tier: "tier3",
    role: "Engineer",
    status: o.status,
    interviewed: o.interviewed ?? (o.rounds ?? []).length > 0,
    updatedAt: o.updatedAt,
    appliedDate: o.appliedDate,
    interviews: o.rounds?.map((kind, i) => ({ round: i + 1, kind })),
  };
}

// The three real shapes this rule has to tell apart, from the live DB.
const GOOGLE = p({ status: "rejected", rounds: ["technical", "behavioral"], updatedAt: "2026-07-30" });
const DATABRICKS = p({ status: "rejected", interviewed: true, updatedAt: "2026-07-02" }); // no rounds logged
const ARCH = p({ status: "rejected", rounds: ["recruiter_screen"], updatedAt: "2026-06-26" });

test("a rejection after a real round cools the company for six months", () => {
  assert.equal(COOLDOWN_MONTHS, 6);
  assert.deepEqual(companyCooldown([GOOGLE], "2026-08-05"), {
    cool: true,
    until: "2027-01-30",
    from: "2026-07-30",
  });
});

test("interviewed=true with NO rounds logged does not cool — the flag alone isn't proof", () => {
  assert.equal(hadRealInterview(DATABRICKS), false);
  assert.deepEqual(companyCooldown([DATABRICKS], "2026-08-05"), { cool: false, reason: "no-qualifying-rejection" });
});

test("a recruiter screen is not an interview", () => {
  assert.equal(hadRealInterview(ARCH), false);
  assert.deepEqual(companyCooldown([ARCH], "2026-08-05"), { cool: false, reason: "no-qualifying-rejection" });
});

test("a recruiter screen followed by a real round DOES count", () => {
  const metropolis = p({ status: "rejected", rounds: ["recruiter_screen", "technical", "hiring_manager"], updatedAt: "2026-07-24" });
  assert.equal(hadRealInterview(metropolis), true);
  assert.deepEqual(companyCooldown([metropolis], "2026-08-05"), { cool: true, until: "2027-01-24", from: "2026-07-24" });
});

test("the expiry boundary: the cooldown is over ON the until date, not after it", () => {
  const day_before = companyCooldown([GOOGLE], "2027-01-29");
  assert.deepEqual(day_before, { cool: true, until: "2027-01-30", from: "2026-07-30" });
  assert.deepEqual(companyCooldown([GOOGLE], "2027-01-30"), { cool: false, reason: "expired" });
  assert.deepEqual(companyCooldown([GOOGLE], "2027-02-01"), { cool: false, reason: "expired" });
});

test("a company you're still active with is never auto-cooled", () => {
  for (const live of ["applied", "interview", "offer"] as Status[]) {
    assert.deepEqual(
      companyCooldown([GOOGLE, p({ status: live })], "2026-08-05"),
      { cool: false, reason: "active-elsewhere" },
      `a live ${live} posting should spare the company`,
    );
  }
});

test("a closed posting elsewhere does NOT count as active", () => {
  const r = companyCooldown([GOOGLE, p({ status: "ghost" }), p({ status: "company_skipped" })], "2026-08-05");
  assert.deepEqual(r, { cool: true, until: "2027-01-30", from: "2026-07-30" });
});

test("two qualifying rejections → the later one sets the date", () => {
  const older = p({ status: "rejected", rounds: ["onsite"], updatedAt: "2026-03-01" });
  const r = companyCooldown([older, GOOGLE], "2026-08-05");
  assert.deepEqual(r, { cool: true, until: "2027-01-30", from: "2026-07-30" });
});

test("ghost, expired and company_skipped never cool, however far they got", () => {
  for (const st of ["ghost", "expired", "company_skipped", "withdrawn"] as Status[]) {
    const r = companyCooldown([p({ status: st, rounds: ["onsite"], updatedAt: "2026-07-30" })], "2026-08-05");
    assert.deepEqual(r, { cool: false, reason: "no-qualifying-rejection" }, `${st} should not cool`);
  }
});

test("the base date falls back to appliedDate when updatedAt is missing", () => {
  const noUpdate = p({ status: "rejected", rounds: ["technical"], appliedDate: "2026-07-30" });
  assert.deepEqual(companyCooldown([noUpdate], "2026-08-05"), { cool: true, until: "2027-01-30", from: "2026-07-30" });
});

test("a qualifying rejection with no date at all can't be dated → no cooldown", () => {
  const undated = p({ status: "rejected", rounds: ["technical"] });
  assert.deepEqual(companyCooldown([undated], "2026-08-05"), { cool: false, reason: "no-qualifying-rejection" });
});

// Pinned, not because Mar 3 is the "right" answer, but so a future change to the date math is a
// deliberate choice rather than a silent drift in a 6-month gate.
test("a month-end rejection rolls forward rather than clamping", () => {
  const augEnd = p({ status: "rejected", rounds: ["technical"], updatedAt: "2026-08-31" });
  assert.deepEqual(companyCooldown([augEnd], "2026-09-01"), { cool: true, until: "2027-03-03", from: "2026-08-31" });
});

test("the date math is timezone-independent", () => {
  const prev = process.env.TZ;
  const seen = new Set<string>();
  for (const tz of ["UTC", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati"]) {
    process.env.TZ = tz;
    const r = companyCooldown([GOOGLE], "2026-08-05");
    seen.add(r.cool ? r.until : "not-cooling");
  }
  process.env.TZ = prev;
  assert.deepEqual([...seen], ["2027-01-30"]);
});

test("no postings at all → nothing to cool", () => {
  assert.deepEqual(companyCooldown([], "2026-08-05"), { cool: false, reason: "no-qualifying-rejection" });
});

// The reapply badge and the cooldown must state the same policy — before this change reapplyInfo
// keyed on the loose `interviewed` flag and would have barred a reapply to Databricks and Arch.
test("reapplyInfo agrees with the cooldown rule", () => {
  assert.deepEqual(reapplyInfo(GOOGLE, "2026-08-05"), { state: "cooldown", until: "2027-01-30" });
  assert.deepEqual(reapplyInfo(DATABRICKS, "2026-08-05"), { state: "eligible" });
  assert.deepEqual(reapplyInfo(ARCH, "2026-08-05"), { state: "eligible" });
  assert.deepEqual(reapplyInfo(GOOGLE, "2027-01-30"), { state: "eligible" });
  assert.deepEqual(reapplyInfo(p({ status: "applied" }), "2026-08-05"), { state: "n/a" });
});
