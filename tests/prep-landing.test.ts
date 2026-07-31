import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isActivelyInterviewing,
  isPastInterviewed,
  nextUpcomingRound,
  nextRoundKindLabel,
} from "@landed/shared/prep/landing";
import type { InterviewRound } from "@landed/shared/types";

test("isActivelyInterviewing is true only for interview/offer", () => {
  assert.equal(isActivelyInterviewing({ status: "interview" }), true);
  assert.equal(isActivelyInterviewing({ status: "offer" }), true);
  assert.equal(isActivelyInterviewing({ status: "applied" }), false);
  assert.equal(isActivelyInterviewing({ status: "rejected" }), false);
  assert.equal(isActivelyInterviewing({ status: "accepted" }), false);
});

test("isPastInterviewed requires interviewed=true AND a terminal status", () => {
  // terminal + interviewed → past
  assert.equal(isPastInterviewed({ status: "rejected", interviewed: true }), true);
  assert.equal(isPastInterviewed({ status: "accepted", interviewed: true }), true);
  assert.equal(isPastInterviewed({ status: "withdrawn", interviewed: true }), true);
  // terminal but never interviewed (e.g. auto-rejected before a screen) → not past
  assert.equal(isPastInterviewed({ status: "rejected", interviewed: false }), false);
  assert.equal(isPastInterviewed({ status: "rejected" }), false);
  // interviewed but still live → not past (belongs under "interviewing now")
  assert.equal(isPastInterviewed({ status: "interview", interviewed: true }), false);
  assert.equal(isPastInterviewed({ status: "offer", interviewed: true }), false);
});

test("nextUpcomingRound picks the earliest pending round by round then date", () => {
  const rounds: InterviewRound[] = [
    { round: 2, kind: "system_design", date: "2026-08-05", outcome: "pending" },
    { round: 1, kind: "phone_screen", date: "2026-07-20", outcome: "passed" },
    { round: 3, kind: "onsite", date: "2026-08-10", outcome: "pending" },
  ];
  const next = nextUpcomingRound(rounds);
  assert.equal(next?.round, 2);
  assert.equal(next?.kind, "system_design");
});

test("nextUpcomingRound returns null when nothing is pending or no rounds", () => {
  assert.equal(nextUpcomingRound([{ round: 1, outcome: "passed" }]), null);
  assert.equal(nextUpcomingRound([]), null);
  assert.equal(nextUpcomingRound(undefined), null);
});

test("nextUpcomingRound tie-breaks equal round numbers by date", () => {
  const rounds: InterviewRound[] = [
    { round: 1, kind: "onsite", date: "2026-08-10", outcome: "pending" },
    { round: 1, kind: "technical", date: "2026-08-03", outcome: "pending" },
  ];
  assert.equal(nextUpcomingRound(rounds)?.kind, "technical");
});

test("nextRoundKindLabel maps kind → human label, falls back sensibly", () => {
  assert.equal(nextRoundKindLabel({ kind: "system_design", outcome: "pending" }), "System design");
  assert.equal(nextRoundKindLabel({ outcome: "pending" }), "Interview");
  assert.equal(nextRoundKindLabel(null), null);
});
