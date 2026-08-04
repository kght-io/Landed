import test from "node:test";
import assert from "node:assert/strict";
import {
  roundWhen,
  hasDetail,
  loopStages,
  currentStageIndex,
  stageWhen,
} from "@landed/shared/pipeline/interview-loop";
import type { InterviewRound } from "@landed/shared/types";

const r = (o: Partial<InterviewRound>): InterviewRound => o;

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

// --- grouping rounds into stages ---------------------------------------------------------------

// The shape that motivated stages: a 7-round loop that is really 5 stages, three of them a single
// same-day block. Rounds 6 and 7 are announced but unscheduled — the case same-day grouping alone
// gets wrong, which is why an explicit `stage` exists.
const FORA: InterviewRound[] = [
  r({ round: 1, kind: "recruiter_screen", date: "2026-07-22", startTime: "13:30", durationMins: 30, outcome: "passed" }),
  r({ round: 2, kind: "technical", date: "2026-07-24", startTime: "11:00", durationMins: 45, outcome: "passed" }),
  r({ round: 3, kind: "behavioral", date: "2026-08-04", startTime: "13:00", durationMins: 30 }),
  r({ round: 4, kind: "system_design", date: "2026-08-04", startTime: "13:45", durationMins: 60 }),
  r({ round: 5, kind: "technical", date: "2026-08-04", startTime: "15:15", durationMins: 60 }),
  r({ round: 6, kind: "hiring_manager", durationMins: 60 }),
  r({ round: 7, kind: "onsite", durationMins: 90 }),
];

test("same-day rounds collapse into one stage; undated ones each stand alone", () => {
  const stages = loopStages(FORA, "2026-08-03");
  assert.deepEqual(stages.map((s) => s.rounds.map((x) => x.round)), [[1], [2], [3, 4, 5], [6], [7]]);
});

test("an explicit stage name groups rounds and titles the stage", () => {
  const stages = loopStages([
    r({ round: 1, kind: "recruiter_screen", stage: "Recruiter Screen", date: "2026-07-22" }),
    // Two rounds on different days that the recruiter still calls one stage — date grouping alone
    // would split these.
    r({ round: 2, kind: "technical", stage: "Technical Assessment", date: "2026-08-04" }),
    r({ round: 3, kind: "system_design", stage: "technical assessment ", date: "2026-08-05" }),
  ], "2026-08-03");
  assert.deepEqual(stages.map((s) => s.label), ["Recruiter Screen", "Technical Assessment"]);
  assert.deepEqual(stages[1].rounds.map((x) => x.round), [2, 3]);
});

test("a stage name that recurs non-adjacently doesn't pull the round out of order", () => {
  const stages = loopStages([
    r({ round: 1, stage: "Onsite", kind: "onsite" }),
    r({ round: 2, stage: "Debrief", kind: "other" }),
    r({ round: 3, stage: "Onsite", kind: "onsite" }),
  ]);
  assert.equal(stages.length, 3, "grouping is consecutive-run, not a global bucket");
  assert.deepEqual(stages.map((s) => s.rounds[0].round), [1, 2, 3]);
  assert.equal(new Set(stages.map((s) => s.key)).size, 3, "keys stay unique for selection");
});

test("an unnamed stage is labelled from its rounds", () => {
  const stages = loopStages(FORA, "2026-08-03");
  assert.deepEqual(stages.map((s) => s.label), [
    "Recruiter screen", // single round → its kind
    "Technical",
    "Interview day", // three kinds in one block → no single kind describes it
    "Hiring manager",
    "Onsite",
  ]);
});

test("a stage's outcome rolls up its rounds — one rejection beats the rounds that passed", () => {
  const stages = loopStages([
    r({ round: 1, date: "2026-07-01", outcome: "passed" }),
    r({ round: 2, date: "2026-07-01", outcome: "passed" }),
    r({ round: 3, date: "2026-07-08", outcome: "passed" }),
    r({ round: 4, date: "2026-07-08", outcome: "rejected" }),
    r({ round: 5, date: "2026-07-15", outcome: "passed" }),
    r({ round: 6, date: "2026-07-15" }),
  ], "2026-07-15");
  assert.deepEqual(stages.map((s) => s.state), ["passed", "rejected", "upcoming"]);
});

test("a stage unions its rounds' attachments, in order, without duplicates", () => {
  const stages = loopStages([
    r({ round: 1, date: "2026-08-04", attachments: ["prep-guide.pdf", "loop.pdf"] }),
    r({ round: 2, date: "2026-08-04", attachments: ["loop.pdf", "take-home.pdf"] }),
  ], "2026-08-03");
  assert.deepEqual(stages[0].attachments, ["prep-guide.pdf", "loop.pdf", "take-home.pdf"]);
});

test("a rejected round doesn't hide a later booked one — the loop is read by round, not by position", () => {
  const stages = loopStages([
    r({ round: 3, kind: "onsite", date: "2026-09-01" }),
    r({ round: 1, kind: "recruiter_screen", date: "2026-07-01", outcome: "passed" }),
    r({ round: 2, kind: "technical", date: "2026-07-08", outcome: "rejected" }),
  ], "2026-08-03");
  assert.deepEqual(stages.map((s) => s.rounds[0].round), [1, 2, 3]);
  assert.equal(currentStageIndex(stages), 2);
});

test("the current stage is the one holding the next pending round", () => {
  assert.equal(currentStageIndex(loopStages(FORA, "2026-08-03")), 2, "the Aug 4 block, not round 3 of 7");
});

test("with nothing pending the current stage is the last one reached", () => {
  const done = FORA.map((x) => ({ ...x, outcome: x.outcome ?? ("rejected" as const) }));
  assert.equal(currentStageIndex(loopStages(done, "2026-08-03")), 4);
  assert.equal(currentStageIndex([]), 0);
});

// --- a date that has passed means it happened -------------------------------------------------

test("a stage whose date has passed is awaiting a next step, not upcoming", () => {
  const stages = loopStages(FORA, "2026-08-10");
  assert.deepEqual(stages.map((s) => s.state), [
    "passed",
    "passed",
    "awaiting", // Aug 4 came and went with no outcome recorded — it happened, they haven't written
    "unscheduled",
    "unscheduled",
  ]);
});


test("a round dated today is still upcoming — the day isn't over", () => {
  assert.equal(loopStages(FORA, "2026-08-04")[2].state, "upcoming");
});

test("the current stage skips what already happened when something later is booked", () => {
  const rounds = [
    r({ round: 1, kind: "technical", date: "2026-07-01" }), // happened, no word back
    r({ round: 2, kind: "onsite", date: "2026-09-01" }), // booked
  ];
  assert.equal(currentStageIndex(loopStages(rounds, "2026-08-03")), 1);
});

test("a stage they've named but not booked still beats one you've already sat", () => {
  const stages = loopStages(FORA, "2026-08-10");
  assert.equal(currentStageIndex(stages), 3, "Technical Leadership — the Aug 4 block is behind you now");
});

test("a loop whose last interview has happened grows a next-step node, and that's where you are", () => {
  // VTS: recruiter screen passed, hiring manager sat on Jul 30, nothing said since. The loop isn't
  // over and it isn't parked on the HM round — you're waiting on a step nobody has named yet.
  const stages = loopStages([
    r({ round: 1, kind: "recruiter_screen", date: "2026-07-20", outcome: "passed" }),
    r({ round: 2, kind: "hiring_manager", date: "2026-07-30", startTime: "15:00", durationMins: 30 }),
  ], "2026-08-03");

  assert.deepEqual(stages.map((s) => s.state), ["passed", "awaiting", "unknown"]);
  assert.deepEqual(stages.map((s) => s.label), ["Recruiter screen", "Hiring manager", "Next step"]);
  assert.equal(currentStageIndex(stages), 2, "the unknown step — the HM round sits behind it");
  assert.deepEqual(stages[2].rounds, [], "there's nothing to show inside it, and that's the point");
  assert.equal(stageWhen(stages[2]), "Not scheduled yet");
});

test("the next-step node appears only when nothing later is already known", () => {
  const sat = r({ round: 1, kind: "technical", date: "2026-07-01" });
  assert.equal(loopStages([sat], "2026-08-03").length, 2, "nothing after it → the step is unknown");
  assert.equal(
    loopStages([sat, r({ round: 2, kind: "onsite" })], "2026-08-03").length,
    2,
    "an onsite they've named IS the next step — no placeholder",
  );
  assert.equal(
    loopStages([sat, r({ round: 2, kind: "onsite", date: "2026-09-01" })], "2026-08-03").length,
    2,
    "and neither when it's booked",
  );
  assert.equal(
    loopStages([{ ...sat, outcome: "rejected" }], "2026-08-03").length,
    1,
    "a closed-out loop has no next step at all",
  );
});

test("an unscheduled stage is current only once nothing earlier is outstanding", () => {
  const stages = loopStages([
    r({ round: 1, kind: "technical", date: "2026-07-01", outcome: "passed" }),
    r({ round: 2, kind: "onsite" }),
  ], "2026-08-03");
  assert.equal(currentStageIndex(stages), 1);
});

// --- when a stage is, in words -----------------------------------------------------------------

test("a multi-round stage reads as its day, count, and total length", () => {
  assert.equal(stageWhen(loopStages(FORA)[2]), "Tue Aug 4 · 3 rounds · 2h30m");
});

test("a one-round stage reads like the round, adding a length the round couldn't show", () => {
  const stages = loopStages(FORA);
  assert.equal(stageWhen(stages[0]), "Wed Jul 22 · 1:30–2:00pm");
  assert.equal(stageWhen(stages[3]), "Not scheduled · 1h", "an unscheduled round still states its length");
});

test("an unscheduled multi-round stage says so without inventing a day", () => {
  const stages = loopStages([r({ round: 1, stage: "Onsite", durationMins: 60 }), r({ round: 2, stage: "Onsite", durationMins: 30 })]);
  assert.equal(stageWhen(stages[0]), "Not scheduled · 2 rounds · 1h30m");
});
