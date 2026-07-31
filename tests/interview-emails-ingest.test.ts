import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, seedApp } from "./helpers";
import { submitJobResult } from "@/lib/jobs/store";
import { listInterviews, listPendingMatches, upsertInterviews } from "@/lib/db/queries";

beforeEach(() => reset());

const pendoRound = {
  round: 3,
  kind: "technical",
  date: "2026-07-29",
  startTime: "1:00pm",
  durationMins: 60,
  timezone: "ET",
  format: "Zoom video, shared screen",
  joinUrl: "https://pendo.zoom.us/j/92158274509",
  interviewers: [
    { name: "Ashish Rangole", title: "Software Engineer (Contractor)" },
    { name: "Zain Lakhani", title: "Chief AI Officer" },
  ],
  whatToExpect: "Shared-screen, hands-on chatbot exercise — applied AI product judgment and tradeoffs.",
  prepNotes: ["Bring a scaffolded local project", "Pre-configure API keys"],
};

test("interview-emails lands the round's substance on the posting's loop", () => {
  const id = seedApp({ company: "Pendo", role: "Staff Software Engineer", status: "interview" });

  submitJobResult({ type: "interview-emails", jobId: "ie-1", records: [{ id, rounds: [pendoRound] }] });

  const [r] = listInterviews(id);
  assert.equal(r.round, 3);
  assert.equal(r.startTime, "13:00", "1:00pm normalized to 24h");
  assert.equal(r.durationMins, 60);
  assert.equal(r.timezone, "ET");
  assert.equal(r.joinUrl, "https://pendo.zoom.us/j/92158274509");
  assert.equal(r.format, "Zoom video, shared screen");
  assert.deepEqual(r.interviewers?.map((p) => p.name), ["Ashish Rangole", "Zain Lakhani"]);
  assert.equal(r.interviewers?.[1].title, "Chief AI Officer");
  assert.match(r.whatToExpect ?? "", /chatbot exercise/);
  assert.equal(r.prepNotes?.length, 2);
});

test("it fills in detail without erasing what inbox-sync already knew about the round", () => {
  const id = seedApp({ company: "Pendo", role: "Staff Software Engineer", status: "interview" });
  // inbox-sync got there first with the thin version.
  upsertInterviews(id, [{ round: 3, kind: "technical", date: "2026-07-29", outcome: "pending", notes: "Technical Exercise", emailId: "thread-abc" }]);

  submitJobResult({
    type: "interview-emails",
    jobId: "ie-2",
    // Reports the substance and stays silent on outcome/emailId — it doesn't own those.
    records: [{ id, rounds: [{ round: 3, whatToExpect: "Shared-screen chatbot build.", joinUrl: "https://z.example/1" }] }],
  });

  const [r] = listInterviews(id);
  assert.equal(r.outcome, "pending", "inbox-sync's outcome survives");
  assert.equal(r.emailId, "thread-abc", "and its thread id");
  assert.equal(r.notes, "Technical Exercise");
  assert.equal(r.date, "2026-07-29");
  assert.equal(r.whatToExpect, "Shared-screen chatbot build.", "the new detail landed");
  assert.equal(r.joinUrl, "https://z.example/1");
});

test("it can correct the loop a thin sync got wrong — adding the rounds it missed", () => {
  const id = seedApp({ company: "Pendo", role: "Staff Software Engineer", status: "interview" });
  // What inbox-sync actually produced for Pendo: the two completed rounds missing, one round split in two.
  upsertInterviews(id, [
    { round: 1, kind: "technical", date: "2026-07-29", notes: "With SWE + Chief AI Officer" },
    { round: 2, kind: "technical", date: "2026-07-29", notes: "Technical Exercise (chatbot build)" },
  ]);

  submitJobResult({
    type: "interview-emails",
    jobId: "ie-3",
    records: [{ id, rounds: [
      { round: 1, kind: "recruiter_screen", date: "2026-07-08", outcome: "passed", interviewers: ["Steve Cosme — Sr. Recruiter II"] },
      { round: 2, kind: "hiring_manager", date: "2026-07-16", outcome: "passed", interviewers: ["Angelo Rodrigues — Staff AI Engineer"] },
      pendoRound,
    ] }],
  });

  const rounds = listInterviews(id);
  assert.equal(rounds.length, 3, "the missed rounds were added");
  assert.deepEqual(rounds.map((r) => r.date), ["2026-07-08", "2026-07-16", "2026-07-29"]);
  assert.deepEqual(rounds.map((r) => r.outcome), ["passed", "passed", undefined]);
  assert.deepEqual(rounds[0].interviewers, [{ name: "Steve Cosme", title: "Sr. Recruiter II" }], "a bare string splits into name + title");
});

test("re-running the capture changes nothing", () => {
  const id = seedApp({ company: "Pendo", role: "Staff Software Engineer", status: "interview" });
  const records = [{ id, rounds: [pendoRound] }];
  submitJobResult({ type: "interview-emails", jobId: "ie-4", records });
  const first = listInterviews(id);
  const out = submitJobResult({ type: "interview-emails", jobId: "ie-5", records });
  assert.deepEqual(listInterviews(id), first);
  assert.match(out.summary, /0|no/i);
});

test("a result with no rounds is still a valid asset-only run (no crash, no rounds)", () => {
  const id = seedApp({ company: "Pendo", role: "Staff Software Engineer", status: "interview" });
  submitJobResult({ type: "interview-emails", jobId: "ie-6", records: [{ id }] });
  assert.equal(listInterviews(id).length, 0);
});

test("an id that doesn't resolve raises an unbound alert instead of vanishing", () => {
  seedApp({ company: "Pendo", role: "Staff Software Engineer", status: "interview" });
  submitJobResult({ type: "interview-emails", jobId: "ie-7", records: [{ id: 999999, company: "Pendo", rounds: [pendoRound] }] });
  assert.ok(listPendingMatches().some((p) => p.kind === "unbound"));
});
