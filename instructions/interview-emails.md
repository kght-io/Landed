# interview-emails

Capture a company's **interviewing emails** — everything recruiters and interviewers send *after* the
recruiter call — into the app. Queued by the **Pull interview emails** button in the drawer's
Interview stage. You report **the emails themselves** and **the structured interview loop** (who /
when / what to expect); it does **not** touch application status, which global inbox-sync owns.

> **The emails go in the DATABASE, not a file.** This job used to write a prose `interview-prep/
> <slug>/emails.md` by hand. It no longer does: emails are rows now (one row per email), and the app
> regenerates `emails.md` from those rows. **Do not write `emails.md`** — your version would be
> overwritten on the next export, and nothing reads it back. Attachments are the exception: they're
> real files and still get downloaded to `attachments/`.

## Input (job params)
- `company` — the company name (for the Gmail search).
- `slug` — the folder key: everything lands under `interview-prep/<slug>/`.
- `since` — a Gmail-style `YYYY/MM/DD` date ~3 months back (the search window).

## Steps
1. **Find the threads.** `searchGmail` for the company's interviewing mail, e.g.
   `"<company>" after:<since>` — also try the recruiter's / company's domain (`from:acme.com OR
   from:greenhouse.io`). You want recruiter outreach, scheduling, "what to expect" notes, take-home
   prompts, team one-pagers, and comp mentions. Ignore unrelated mail.
2. **Read the threads.** `getGmailThread` each relevant thread. Keep the interviewing-relevant
   messages: recruiter outreach, scheduling and confirmations, "what to expect" notes, take-home
   prompts, team one-pagers, comp mentions. Drop the noise — availability ping-pong, portal codes,
   calendar-system boilerplate. You're deciding what's worth remembering, not archiving a mailbox.
3. **Download attachments.** For every thread that carries a file (role PDF, prep guide, take-home
   spec), call **`downloadGmailAttachments(id: <threadId>, slug: "<slug>")`** — the app saves the
   files into `interview-prep/<slug>/attachments/` and returns their names. Report the returned names
   on the *email* that carried them and on the *round* that thread is about, so the drawer can link
   the file from the stage it belongs to.
4. **Report the emails and the loop.** Submit ONE record for the posting, carrying both arrays:

   ```json
   submitJobResult({ type: "interview-emails", jobId: "<this job>", records: [
     { "id": 903161,
       "emails": [
         { "threadId": "18f2c9a0b1", "messageId": "18f2c9a0b1c2",
           "subject": "Acme — Technical Exercise",
           "from": "Steve Cosme <stephen@acme.com>", "to": ["me@example.com"],
           "date": "2026-07-21T16:30:00Z", "round": 3,
           "attachments": ["acme-take-home.pdf"],
           "body": "Hi — great news, the team would like to move you to the Technical Exercise…" }
       ],
       "rounds": [
       { "round": 1, "stage": "Recruiter Screen",
         "kind": "recruiter_screen", "date": "2026-07-08", "outcome": "passed",
         "interviewers": [{ "name": "Steve Cosme", "title": "Sr. Recruiter II" }] },
       { "round": 3, "stage": "Technical Assessment", "kind": "technical", "date": "2026-07-29",
         "startTime": "1:00pm", "durationMins": 60, "timezone": "ET",
         "format": "Zoom video, shared screen",
         "joinUrl": "https://acme.zoom.us/j/9215827",
         "interviewers": [{ "name": "Zain Lakhani", "title": "Chief AI Officer" }],
         "whatToExpect": "Shared-screen chatbot exercise — they want applied-AI judgment, real-time tradeoffs, and adapting when challenged mid-session.",
         "prepNotes": ["Bring a scaffolded local project", "Pre-configure API keys", "Be ready to defend architecture + guardrails"],
         "attachments": ["acme-take-home.pdf"] }
     ] }
   ] })
   ```

   - **`id` is required** — the posting id the app stamped on the job. It's the only key; a wrong or
     missing id parks the result as an unbound alert instead of landing.
   - Both arrays are **optional and independent**: a run that finds mail but can't yet make out the
     loop reports `emails` alone, and vice versa. Report what you actually read.

   ### `emails` — one entry per email
   - **`body` is required** and is the whole point: the message text, as prose. An entry without one
     is dropped. Keep it substantially verbatim — trim signatures, quoted reply chains, and legal
     footers, but do **not** summarize. This is the text a future chat searches to answer "what did
     the recruiter say about comp?", and a summary you wrote today can't answer a question you
     haven't thought of yet.
   - **`threadId`** — the Gmail thread id. Report it on every email you can: it's what joins these
     rows to the threads already linked on the posting and its rounds, so an answer found in one
     email can pull in its siblings.
   - **`messageId`** — the Gmail message id. It's the dedup key, so a re-run over threads you already
     captured is a clean no-op. Without it the app falls back to thread + date + subject.
   - **`date`** — when it was sent (ISO preferred). It's the sort key; emails without one sort last.
   - **`from`** as the header states it (`"Steve Cosme <stephen@acme.com>"`), `to` as a list.
   - **`round`** when the mail is clearly about one round — the link between a message and the loop.
   - **`attachments`** — the filenames `downloadGmailAttachments` returned for this message.
   - **One row per email, not per thread.** A five-message thread is five entries sharing a
     `threadId`, not one merged blob. The whole reason for the split is that a single message is the
     unit a later question gets answered from.

   ### `rounds` — the structured loop
   - **`round`** numbers the loop chronologically (1 = first). Keep them stable across re-runs — the
     app merges on `round`, so a stable number updates a round in place instead of duplicating it.
   - **`stage`** is the recruiter's own name for the block a round sits in — "Technical Assessment",
     "Technical Leadership", "Onsite (Final Round)". Consecutive rounds sharing one become a single
     stage in the drawer, which is how a three-interview day reads as one thing instead of three.
     Copy the name from the email verbatim and keep it byte-stable across re-runs. Report it for
     **every** round of a loop you understand, including ones not yet scheduled — without it the app
     falls back to grouping by date, and two undated future stages collapse into one.
   - **`whatToExpect`** is the one that matters most: what they actually said the round IS. Write it
     as prose you'd want to read the night before, not a label.
   - **`prepNotes`** is their how-to-prepare list, one item per entry.
   - **`attachments`** is the filenames `downloadGmailAttachments` returned for that round's thread
     (exactly as returned — the app links them out of `attachments/` by name).
   - **`startTime`** accepts `"1:00pm"` or `"13:00"`; give `timezone` exactly as the email stated it
     (`"ET"`). Omit rather than guess — a wrong time on the Up-next card is worse than no time.
   - **Omit any field you don't know.** Omitted fields keep whatever is already stored; they are not
     erased. That's what lets you and inbox-sync write the same rounds without fighting.

   Add a one-line `summary` (e.g. "captured 11 emails across 5 threads · 2 attachments · 3 rounds").

## Boundaries
- **Do not** change application status or set comp/JD in the DB — global inbox-sync owns tracker
  state. You own the interview **loop**: the rounds, and the substance of each one.
- **Do not write `emails.md` or anything under `transcripts/`** — both are regenerated from the
  database and your edit would be thrown away. Report `emails` instead.
- Where you and inbox-sync overlap (a round's `kind` / `date` / `outcome`), what you report wins —
  you read the whole thread, it classified a single email. So correct a loop you can see is wrong:
  add the rounds it missed, fix a date it got wrong. Just don't report a field you didn't verify.
- Re-running is a no-op: emails dedup on `messageId`, rounds merge on `round`, and attachments
  de-dupe by name. Re-capturing a thread that has grown since only adds its new messages.
- The `interview-brief` job reads the `emails.md` the app regenerates from your rows, so favor
  complete bodies and interviewer names over tidy prose.
