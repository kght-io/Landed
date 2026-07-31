import test from "node:test";
import assert from "node:assert/strict";
import { nextRound, roundWhen, hasDetail } from "@/lib/interview-loop";
import type { InterviewRound } from "@/lib/types";

const r = (o: Partial<InterviewRound>): InterviewRound => o;

// --- which round is "up next" ------------------------------------------------------------------

test("the next round is the first one still pending", () => {
  const rounds = [
    r({ round: 1, kind: "recruiter_screen", outcome: "passed" }),
    r({ round: 2, kind: "technical", outcome: "passed" }),
    r({ round: 3, kind: "onsite", outcome: "pending", date: "2026-07-29" }),
  ];
  assert.equal(nextRound(rounds)?.round, 3);
});

test("a round with no outcome counts as pending", () => {
  assert.equal(nextRound([r({ round: 1, outcome: "passed" }), r({ round: 2 })])?.round, 2);
});

test("nothing pending → no up-next (the loop is done or closed out)", () => {
  assert.equal(nextRound([r({ round: 1, outcome: "passed" }), r({ round: 2, outcome: "rejected" })]), null);
  assert.equal(nextRound([]), null);
});

test("a rejected round doesn't hide a later pending one — order by round, not by array position", () => {
  const rounds = [r({ round: 3, outcome: "pending" }), r({ round: 1, outcome: "passed" }), r({ round: 2, outcome: "passed" })];
  assert.equal(nextRound(rounds)?.round, 3);
});

// --- when it is, in words ----------------------------------------------------------------------

test("a scheduled round reads as a date with its time window and zone", () => {
  assert.equal(
    roundWhen(r({ date: "2026-07-29", startTime: "13:00", durationMins: 60, timezone: "ET" })),
    "Wed Jul 29 · 1:00–2:00pm ET",
  );
});

test("a start time with no duration doesn't invent an end", () => {
  assert.equal(roundWhen(r({ date: "2026-07-29", startTime: "13:00", timezone: "ET" })), "Wed Jul 29 · 1:00pm ET");
});

test("times cross noon and midnight correctly", () => {
  assert.equal(roundWhen(r({ date: "2026-07-29", startTime: "11:30", durationMins: 60 })), "Wed Jul 29 · 11:30am–12:30pm");
  assert.equal(roundWhen(r({ date: "2026-07-29", startTime: "00:15" })), "Wed Jul 29 · 12:15am");
});

test("a date-only round says just the date; an unscheduled one says so", () => {
  assert.equal(roundWhen(r({ date: "2026-07-29" })), "Wed Jul 29");
  assert.equal(roundWhen(r({})), "Not scheduled");
});

test("a junk date is passed through rather than rendered as Invalid Date", () => {
  assert.equal(roundWhen(r({ date: "sometime next week" })), "sometime next week");
});

// --- is there anything worth expanding? --------------------------------------------------------

test("hasDetail is true only when the round carries more than its headline", () => {
  assert.equal(hasDetail(r({ round: 1, kind: "onsite", date: "2026-07-29" })), false);
  assert.equal(hasDetail(r({ whatToExpect: "Shared-screen chatbot build." })), true);
  assert.equal(hasDetail(r({ prepNotes: ["Bring a scaffold"] })), true);
  assert.equal(hasDetail(r({ interviewers: [{ name: "Zain Lakhani" }] })), true);
  assert.equal(hasDetail(r({ notes: "With SWE + Chief AI Officer" })), true);
  assert.equal(hasDetail(r({ prepNotes: [] })), false, "an empty list isn't detail");
});
