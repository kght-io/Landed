# interview-emails

Capture a company's **interviewing emails** — everything recruiters and interviewers send *after* the
recruiter call — into that company's `interview-prep/<slug>/` folder. Queued by the **Pull interview
emails** button in the drawer's Interview stage. It writes the prep files **and** reports the
structured interview loop (who / when / what to expect) back to the app — it does **not** touch
application status, which global inbox-sync owns.

## Input (job params)
- `company` — the company name (for the Gmail search).
- `slug` — the folder key: everything lands under `interview-prep/<slug>/`.
- `since` — a Gmail-style `YYYY/MM/DD` date ~3 months back (the search window).

## Steps
1. **Find the threads.** `searchGmail` for the company's interviewing mail, e.g.
   `"<company>" after:<since>` — also try the recruiter's / company's domain (`from:acme.com OR
   from:greenhouse.io`). You want recruiter outreach, scheduling, "what to expect" notes, take-home
   prompts, team one-pagers, and comp mentions. Ignore unrelated mail.
2. **Read + write `emails.md`.** `getGmailThread` each relevant thread and write
   `interview-prep/<slug>/emails.md` structured **for prep**, not as a raw dump — group by round /
   interviewer:
   - **Who** you're meeting: name · title · LinkedIn (from the signature) — so the brief can prep you
     per interviewer.
   - **Format / what to expect** the recruiter or interviewer described for each round.
   - **Prep material / take-home**: links + instructions.
   - **Logistics**: dates, durations, panel.
   - **Comp** figures if mentioned.
3. **Download attachments.** For every thread that carries a file (role PDF, prep guide, take-home
   spec), call **`downloadGmailAttachments(id: <threadId>, slug: "<slug>")`** — the app saves the
   files into `interview-prep/<slug>/attachments/` and returns their names. Reference them in
   `emails.md`.
4. **Report the loop.** Submit ONE record for the posting — the same rounds you just wrote up, in
   structured form, so the app can show them on the posting instead of leaving them buried in a file:

   ```json
   submitJobResult({ type: "interview-emails", jobId: "<this job>", records: [
     { "id": 903161, "rounds": [
       { "round": 1, "kind": "recruiter_screen", "date": "2026-07-08", "outcome": "passed",
         "interviewers": [{ "name": "Steve Cosme", "title": "Sr. Recruiter II" }] },
       { "round": 3, "kind": "technical", "date": "2026-07-29",
         "startTime": "1:00pm", "durationMins": 60, "timezone": "ET",
         "format": "Zoom video, shared screen",
         "joinUrl": "https://acme.zoom.us/j/9215827",
         "interviewers": [{ "name": "Zain Lakhani", "title": "Chief AI Officer" }],
         "whatToExpect": "Shared-screen chatbot exercise — they want applied-AI judgment, real-time tradeoffs, and adapting when challenged mid-session.",
         "prepNotes": ["Bring a scaffolded local project", "Pre-configure API keys", "Be ready to defend architecture + guardrails"] }
     ] }
   ] })
   ```

   - **`id` is required** — the posting id the app stamped on the job. It's the only key; a wrong or
     missing id parks the result as an unbound alert instead of landing.
   - **`round`** numbers the loop chronologically (1 = first). Keep them stable across re-runs — the
     app merges on `round`, so a stable number updates a round in place instead of duplicating it.
   - **`whatToExpect`** is the one that matters most: what they actually said the round IS. Write it
     as prose you'd want to read the night before, not a label.
   - **`prepNotes`** is their how-to-prepare list, one item per entry.
   - **`startTime`** accepts `"1:00pm"` or `"13:00"`; give `timezone` exactly as the email stated it
     (`"ET"`). Omit rather than guess — a wrong time on the Up-next card is worse than no time.
   - **Omit any field you don't know.** Omitted fields keep whatever is already stored; they are not
     erased. That's what lets you and inbox-sync write the same rounds without fighting.

   Add a one-line `summary` (e.g. "wrote emails.md from 5 threads · 2 attachments · 3 rounds").

## Boundaries
- **Do not** change application status or set comp/JD in the DB — global inbox-sync owns tracker
  state. You own the interview **loop**: the rounds, and the substance of each one.
- Where you and inbox-sync overlap (a round's `kind` / `date` / `outcome`), what you report wins —
  you read the whole thread, it classified a single email. So correct a loop you can see is wrong:
  add the rounds it missed, fix a date it got wrong. Just don't report a field you didn't verify.
- Re-running overwrites `emails.md` (fine) and adds any new attachments (de-duped by name).
  Re-reporting the same rounds is a no-op.
- The `interview-brief` job reads what you write here, so favor clarity and interviewer names.
