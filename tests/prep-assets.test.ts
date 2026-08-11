import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { reset, seedApp } from "./helpers";
import { sqlite } from "@landed/backend/db";
import { backfillPrepAssets } from "@landed/backend/db/backfill-prep-assets";
import { listPrepEmails, emailsCapturedAt } from "@landed/backend/db/prep-assets";
import { PREP_ROOT, exportPrepContextFor } from "@landed/backend/prep/export-context";
import { listTranscripts, saveTranscript, readTranscript } from "@landed/backend/prep/transcripts";
import { submitJobResult } from "@landed/backend/jobs/store";
import { listInterviews } from "@landed/backend/db/queries";
import { gatherPeerInputs } from "@landed/backend/peercomp/inputs";

beforeEach(() => reset());

// Lay down the pre-migration on-disk shape for one company: the prose emails.md blob the
// interview-emails job used to write, plus whatever transcripts were pasted into transcripts/.
function seedDisk(slug: string, opts: { emails?: string; transcripts?: Record<string, string> }) {
  const dir = path.join(PREP_ROOT, slug);
  fs.mkdirSync(dir, { recursive: true });
  if (opts.emails) fs.writeFileSync(path.join(dir, "emails.md"), opts.emails);
  if (opts.transcripts) {
    fs.mkdirSync(path.join(dir, "transcripts"), { recursive: true });
    for (const [name, body] of Object.entries(opts.transcripts)) {
      fs.writeFileSync(path.join(dir, "transcripts", name), body);
    }
  }
}

const rmPrep = () => fs.rmSync(PREP_ROOT, { recursive: true, force: true });

test("the backfill imports the transcripts and emails already sitting on disk", () => {
  rmPrep();
  seedDisk("pendo", {
    emails: "# Pendo — Interview Emails\n\n## Round 3 — Technical Exercise\nBring a scaffolded project.\n",
    transcripts: { "transcript-1.md": "# Recruiter screen\n\nHow are you doing?\n" },
  });
  seedDisk("vts", { transcripts: { "transcript-1.md": "# Hiring manager round\n\nI'm Jonathan Perez.\n" } });

  const n = backfillPrepAssets(sqlite, PREP_ROOT);
  assert.deepEqual(n, { transcripts: 2, emails: 1, errors: 0, scanned: true });

  const [t] = listTranscripts("pendo");
  assert.equal(t.name, "transcript-1.md");
  assert.equal(t.title, "Recruiter screen", "the leading H1 becomes the title");
  assert.match(readTranscript("pendo", "transcript-1.md") ?? "", /How are you doing/);
  assert.equal(listTranscripts("vts").length, 1);

  // Round-trip: re-dumping an imported transcript must reproduce the file it came from. The title
  // is stored separately and re-prepended as an H1, so leaving it in the body too would render the
  // heading twice — silently rewriting the user's transcripts on the first export.
  assert.equal(
    readTranscript("pendo", "transcript-1.md"),
    "# Recruiter screen\n\nHow are you doing?\n",
    "the dump is byte-identical to what was imported",
  );

  const emails = listPrepEmails("pendo");
  assert.equal(emails.length, 1, "the legacy prose blob imports as one row, not fabricated per-email rows");
  assert.match(emails[0].body, /Bring a scaffolded project/);
  assert.equal(emails[0].subject, "Pendo — Interview Emails", "the H1 becomes the subject");

  // Running it twice must not duplicate — the unique keys make it idempotent.
  assert.deepEqual(backfillPrepAssets(sqlite, PREP_ROOT), { transcripts: 0, emails: 0, errors: 0, scanned: true });
  assert.equal(listPrepEmails("pendo").length, 1);
  assert.equal(listTranscripts("pendo").length, 1);
});

// The gate this protects: the import is recorded as done only once it has really read a prep tree.
// A boot with no folder yet — a fresh clone, or ASSET_ROOT not configured so the default empty path
// applies — imports nothing, and marking THAT as done would strand the user's real files forever.
test("a missing prep tree reads as not-yet-scanned, not as an empty import", () => {
  rmPrep();
  const n = backfillPrepAssets(sqlite, PREP_ROOT);
  assert.deepEqual(n, { transcripts: 0, emails: 0, errors: 0, scanned: false });

  // Whereas a tree that IS there but holds nothing to import is genuinely finished.
  fs.mkdirSync(PREP_ROOT, { recursive: true });
  assert.deepEqual(backfillPrepAssets(sqlite, PREP_ROOT), { transcripts: 0, emails: 0, errors: 0, scanned: true });
});

// Only a heading on the FIRST line is the transcript's title. An H1 further down is part of the
// call itself — lifting it would mislabel the transcript, and since the dump re-prepends the title
// as an H1, it would also duplicate that heading into the user's file on the next export.
test("an H1 partway through a transcript stays in the body", () => {
  rmPrep();
  const body = "Interviewer: tell me about yourself.\n\n# Closing questions\n\nAny questions for us?\n";
  seedDisk("pendo", { transcripts: { "transcript-1.md": body } });

  backfillPrepAssets(sqlite, PREP_ROOT);
  const [t] = listTranscripts("pendo");
  assert.equal(t.title, undefined, "a mid-document heading is not the title");
  assert.equal(readTranscript("pendo", "transcript-1.md"), body, "and the file round-trips unchanged");
});

test("a pasted transcript is stored in the DB and still dumped to disk", () => {
  rmPrep();
  const file = saveTranscript("pendo", "Interviewer: tell me about yourself.", "Recruiter screen");

  const rows = listTranscripts("pendo");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, file.name);
  assert.equal(rows[0].name, "transcript-1.md");
  assert.ok(rows[0].bytes > 0);
  assert.match(readTranscript("pendo", file.name) ?? "", /^# Recruiter screen/, "the title is kept as an H1");

  // The file is a DUMP of the row now, not the record — but it must still be there for the chat.
  const onDisk = fs.readFileSync(path.join(PREP_ROOT, "pendo", "transcripts", file.name), "utf8");
  assert.match(onDisk, /tell me about yourself/);

  // Numbering keeps counting off the stored rows, not the folder.
  assert.equal(saveTranscript("pendo", "Second one.").name, "transcript-2.md");
});

test("interview-emails lands one row per email, each carrying its thread id", () => {
  rmPrep();
  const id = seedApp({ company: "Pendo", role: "Staff Software Engineer", status: "interview" });

  const emails = [
    {
      threadId: "thread-abc", messageId: "msg-1", subject: "Pendo Interview Request",
      from: "Steve Cosme <stephen@pendo.io>", to: ["me@example.com"], date: "2026-07-03T14:02:00Z",
      round: 1, body: "Would you be open to a 30-minute chat about the Staff AI role?",
    },
    {
      threadId: "thread-abc", messageId: "msg-2", subject: "Re: Pendo Interview Request",
      from: "me@example.com", date: "2026-07-04T09:00:00Z", body: "Yes — Tuesday works.",
    },
    {
      threadId: "thread-xyz", messageId: "msg-3", subject: "Technical Exercise",
      from: "Steve Cosme <stephen@pendo.io>", date: "2026-07-21T16:30:00Z", round: 3,
      attachments: ["pendo-take-home.pdf"], body: "Come with a scaffolded local project.",
    },
  ];
  submitJobResult({ type: "interview-emails", jobId: "ie-e1", records: [{ id, emails }] });

  const rows = listPrepEmails("pendo");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((e) => e.threadId), ["thread-abc", "thread-abc", "thread-xyz"]);
  assert.deepEqual(rows.map((e) => e.subject), [
    "Pendo Interview Request", "Re: Pendo Interview Request", "Technical Exercise",
  ], "oldest first");
  assert.equal(rows[0].from, "Steve Cosme <stephen@pendo.io>");
  assert.equal(rows[0].round, 1);
  assert.deepEqual(rows[2].attachments, ["pendo-take-home.pdf"]);
  assert.match(rows[2].body, /scaffolded local project/);
  assert.ok(emailsCapturedAt("pendo"), "the drawer's 'captured at' now comes from the rows");

  // The dump still lands for the prep chat, regenerated from the rows.
  const dumped = fs.readFileSync(path.join(PREP_ROOT, "pendo", "emails.md"), "utf8");
  assert.match(dumped, /scaffolded local project/);
  assert.match(dumped, /thread-xyz/);

  // Re-capturing the same threads is a no-op.
  submitJobResult({ type: "interview-emails", jobId: "ie-e2", records: [{ id, emails }] });
  assert.equal(listPrepEmails("pendo").length, 3);
});

// Two messages in one batch can collide on the header-derived key (same thread, date and subject)
// when the agent didn't send a messageId. They must not silently cancel each other out.
test("two emails that collide on the fallback key leave a row holding the later content", () => {
  rmPrep();
  const id = seedApp({ company: "Pendo", role: "Staff Software Engineer", status: "interview" });
  submitJobResult({
    type: "interview-emails", jobId: "ie-dup",
    records: [{ id, emails: [
      { threadId: "t1", subject: "Scheduling", date: "2026-07-21", body: "Does Tuesday work?" },
      { threadId: "t1", subject: "Scheduling", date: "2026-07-21", body: "Tuesday works — sending an invite." },
    ] }],
  });

  const rows = listPrepEmails("pendo");
  assert.equal(rows.length, 1, "one key, one row");
  assert.match(rows[0].body, /sending an invite/, "the later content is what survived, not a lost write");
});

test("an email capture and a loop capture ride in on the same result", () => {
  rmPrep();
  const id = seedApp({ company: "Pendo", role: "Staff Software Engineer", status: "interview" });
  const out = submitJobResult({
    type: "interview-emails", jobId: "ie-e3",
    records: [{
      id,
      rounds: [{ round: 3, kind: "technical", date: "2026-07-29", whatToExpect: "Chatbot build." }],
      emails: [{ threadId: "t1", messageId: "m1", subject: "Confirmation", body: "1:00pm ET." }],
    }],
  });
  assert.equal(listPrepEmails("pendo").length, 1);
  assert.equal(listInterviews(id).length, 1, "the loop landed too");
  assert.match(
    (out.details ?? []).map((d) => d.summary).join(" "),
    /1 interview round detailed · 1 email captured/,
    "the change says both halves landed",
  );
});

test("context.md still carries the transcript and email sections, now from the DB", () => {
  rmPrep();
  const id = seedApp({ company: "Pendo", role: "Staff Software Engineer", status: "interview" });
  saveTranscript("pendo", "So tell me about the hardest system you've built.", "Recruiter screen");
  submitJobResult({
    type: "interview-emails", jobId: "ie-e4",
    records: [{ id, emails: [{ threadId: "t1", messageId: "m1", subject: "Technical Exercise", from: "steve@pendo.io", date: "2026-07-21", body: "Come with a scaffold." }] }],
  });

  assert.ok(exportPrepContextFor("pendo"));
  const md = fs.readFileSync(path.join(PREP_ROOT, "pendo", "context.md"), "utf8");
  assert.match(md, /## Call transcripts/);
  assert.match(md, /Recruiter screen/, "the stored transcript is listed");
  assert.match(md, /## Captured emails/);
  assert.match(md, /Technical Exercise/, "the stored email is listed");
});

test("gatherPeerInputs still finds email signal for an interviewing role", () => {
  rmPrep();
  const id = seedApp({ company: "Pendo", role: "Staff Software Engineer", status: "interview" });
  submitJobResult({
    type: "interview-emails", jobId: "ie-e5",
    records: [{ id, emails: [{ threadId: "t1", messageId: "m1", subject: "Offer details", body: "Base 250k, equity 0.1%." }] }],
  });

  const [role] = gatherPeerInputs();
  assert.equal(role.company, "Pendo");
  assert.match(role.emails ?? "", /Base 250k/, "the comp signal comes off the rows, not emails.md");
});

test("a role with no captured email carries no email signal", () => {
  rmPrep();
  seedApp({ company: "Fora", role: "Senior Software Engineer", status: "interview" });
  const [role] = gatherPeerInputs();
  assert.equal(role.emails, undefined);
});
