# Job: inbox

Audit my Gmail for job-application emails and report current status per application.

> **Read mail via the jobhunt MCP tools — `searchGmail` and `getGmailThread` (both READ-ONLY).**
> The app owns Gmail access (over IMAP, app password), so these work the same for any client and
> don't depend on any external Gmail connector. `searchGmail({ query, limit? })` takes normal Gmail
> search syntax (`after:`, `-category:promotions`, `from:`, `filename:invite.ics`) and returns
> threads newest-first with a `snippet` + a stable `threadId`; `getGmailThread({ id })` opens one
> full thread by that `threadId`. Put that `threadId` in `emailRefs`/`emailId` (it deep-links to the
> message). If `searchGmail` errors with "gmail not configured", tell the user to connect Gmail in the
> app's Settings (Connect Gmail → app password); don't fall back to any other mail source.

## Steps
1. Search my inbox for job-application email. **Choose the retrieval strategy by window
   size** — the window is `now − params.since`.

   `params.since` is set by the app on every queued sync and is a **UNIX epoch in seconds**
   (`1784953419`) — **use it verbatim as your `searchGmail` `after:` filter**, i.e.
   `after:1784953419`. Don't reformat it into a `YYYY/MM/DD` date: Gmail reads a calendar date in
   the account's local timezone but reads an epoch as an absolute instant, and only the epoch
   matches the watermark exactly. Don't swap in `newer_than:Nd` either — Gmail measures "ago" from
   when the query runs, which may be hours after this job was queued.

   It is the last-synced watermark **backed off by an hour on purpose**, or 120 days back on the
   first run. Don't "tighten" that overlap to the watermark itself: the watermark is stamped when
   the app ingested the last result, not at the newest message that was read, so the last stretch
   of mail hasn't definitely been looked at. Re-seeing an hour of mail is free (a change you
   re-report either dedups onto the existing card or, if it's already approved, produces nothing).

   Only if `params.since` is absent entirely (a run you self-initiated): read `inboxLastSynced`
   from the `getContext` MCP tool — it's an ISO timestamp — and search from an hour before it. The
   app advances the watermark automatically after it ingests your result — never set it yourself.

   **Why strategy depends on window size:** snippets come back *free* in `searchGmail`
   results (no extra `getGmailThread` call needed to classify), so the real cost is the token
   volume of every snippet you pull into context — and that scales with how cluttered the
   inbox is, not with how many job emails exist. A few hours of mail is a handful of
   threads; 120 days can be thousands of newsletters and promos. So:

   - **Incremental run (window ≤ ~7 days) — full sweep.** Pull *everything* since the
     watermark with a bare `after:` query (no sender/keyword filter at all) and classify
     each thread from its snippet. The volume is small, and recall matters more than
     precision here. This is what catches the long-tail senders that filtered passes miss:
     a Workable relay address (`…@inbound.workablemail.com`), a recruiter on a personal or
     agency domain, a plain "thanks for your time" rejection subject — none of which match
     an ATS sender or job keyword.

   - **Cold start / large window (> ~7 days) — broad-but-pruned sweep.** A full unfiltered
     sweep of 120 days is wasteful (you'd read thousands of promos to find a dozen job
     emails). Instead, widen the net but subtract the known noise:
     `after:<since> -category:promotions -category:social`. ATS and recruiter mail lands in
     Primary/Updates; promotions+social is where almost all the junk lives, so this keeps
     most of the recall at a fraction of the cost. Union with the two targeted passes below
     to backstop anything misfiled.

   In **all** cases also run these two targeted passes and **union** the results (they're
   cheap and cover misfiled mail):
   - **ATS / relay pass** — ATS senders *and their mail-relay domains*: greenhouse,
     lever, ashby, workday, icims, **workablemail.com**, **greenhouse-mail.io**, etc.,
     plus subjects about applications/interviews.
   - **Calendar-invite pass** — `filename:invite.ics` (optionally also `subject:Invitation`).
     Recruiter-scheduled screens often arrive as a Google Calendar invite from a personal or
     agency domain (e.g. `recruiter@example.com`) with a generic subject like
     `Invitation: You and Jordan @ …` — these match no ATS sender or job keyword, so the
     ATS pass alone misses them. The `.ics` attachment is the reliable signal that a meeting
     was booked.

   Broad retrieval, **strict interpretation.** The sweeps deliberately pull in non-job mail
   (apartment tours, social events, promos, personal calls). **Discard those at the
   reasoning step (Step 2/3)** — keep only mail tied to a recruiter, a tracked company, an
   application, or an interview.
2. Group by application (company + role). Reason over the **whole thread**.
   Normalize the **company name** to its canonical brand form (see "Company name" below)
   before grouping, so the same company never splits into two spellings.
3. For each application, determine:
   - **Status**: `applied` (confirmation, nothing since) · `interviewing` (recruiter
     call / interview / OA scheduled or in progress) · `rejected` · `no_response`
     (confirmation but nothing after ~30 days) · `offer`.
   - **Interviewed** (yes/no): yes if ANY interview, recruiter call, or online
     assessment appears anywhere in the thread — critical for rejections, look back
     through the whole thread.
   - **Interview rounds** (`interviews`): when the thread shows scheduled or completed
     interview stages, list them in order — one entry per round. Pull the round **kind**
     and its **date** from the scheduling/confirmation emails, and the **outcome** if the
     thread reveals it (advanced to a next round / explicit pass = `passed`; the rejection
     lands on the last round = `rejected`; scheduled or awaiting result = `pending`). A
     round that's only mentioned but never scheduled can be omitted. Always include rounds
     for any application whose `status` is `interviewing` or `offer`.
     - **The recruiter screen / recruiter call counts as a round in its own right** — it's
       `round: 1` (`kind: "recruiter_screen"`), not a pre-screen to fold into "applied". If
       the recruiter call is the only stage so far, that's still one round (round 1 of 1).

## Company name (canonical)
The `Company` value must be the company's **canonical brand name** — not whatever the
email sender, ATS subdomain, or signature happens to show. One company = one spelling.

- **Official brand casing.** `GitHub`, `OpenAI`, `MongoDB`, `EliseAI`, `Norm AI`,
  `Scale AI` — never all-lowercase (`satoriq` → `Satoriq`, matching how the company
  writes its own name on its careers site). When unsure of exact casing, use the
  spelling on the company's homepage/careers page.
- **No legal suffixes or trailing punctuation.** Drop `Inc.`, `LLC`, `Corp`, `Co.`,
  `Ltd`, `GmbH`, and any trailing `, Inc`.
- **No parenthetical qualifiers; roll labs/orgs up to the parent company.** Use the
  company, not an internal lab, org, or product: `Google` (not `DeepMind (Google)` or
  `Google DeepMind` — DeepMind is a *team*, so it goes in the **Team** column, not the
  company), `Google` (not `Google (Careers)`).
- **Brand, not the ATS host.** If a sender domain or ATS URL differs from the brand
  (e.g. `boards.greenhouse.io/acmeco`), use the brand (`Acme`), not the slug.

## Output
Hand the result back with the **`submitJobResult` MCP tool** — `type: "inbox-sync"`, `jobId` =
the job's id (omit for a self-initiated run), and `records` = one object per application attempt:

```json
[
  { "company": "Netflix", "role": "Senior SWE", "level": "Senior", "team": "Ads",
    "location": "Remote", "status": "rejected", "interviewed": true,
    "appliedDate": "2026-05-02", "lastUpdate": "2026-06-01",
    "channel": "direct", "source": "greenhouse", "url": "https://...",
    "note": "Rejected after onsite.",
    "emailRefs": { "applied": "18c...", "rejected": "18f..." },
    "interviews": [
      { "round": 1, "kind": "recruiter_screen", "date": "2026-05-10", "outcome": "passed", "emailId": "18d..." },
      { "round": 2, "kind": "technical", "date": "2026-05-18", "outcome": "passed", "emailId": "18d..." },
      { "round": 3, "kind": "onsite", "date": "2026-05-28", "outcome": "rejected", "emailId": "18e..." }
    ] }
]
```

- `status` — one of the lowercase values above (`applied` · `interviewing` · `rejected` ·
  `no_response` · `offer`). `interviewed` — boolean.
- Dates `YYYY-MM-DD`; omit fields you don't know.
- `channel` — `referral` or `direct`. `source` — greenhouse | lever | ashby | company site | other.
- **`emailRefs`** (optional, recommended) — the Gmail **thread id** for the email that drove each
  stage, so the tracker can deep-link straight to the message: `{ applied?, rejected?, offer?,
  interview? }`. Use the `id` of the thread from your Gmail search results (the same id `#all/<id>`
  opens in the web inbox). Omit any you can't identify — the app falls back to a Gmail search link.
- `interviews` — ordered array of rounds (omit when there are none). Each: `round` (1-based
  order), `kind` (one of `recruiter_screen` · `phone_screen` · `technical` · `system_design` ·
  `behavioral` · `onsite` · `hiring_manager` · `final` · `other`), `date` (`YYYY-MM-DD`),
  `outcome` (`passed` · `rejected` · `pending`), optional `notes`, optional **`emailId`** (the
  Gmail thread id for that round's email — enables a direct link, falls back to search if omitted).
  Re-sync is idempotent — the app merges rounds by `round` number, so resubmitting updates an
  outcome in place rather than duplicating. Keep `round` numbers stable across syncs.
- One record per application attempt (don't merge re-applies).

The app records the job and advances the inbox watermark automatically — no `done/` move.

## What happens to your result (the approval boundary)

**Nothing you report edits the tracker directly.** Email is inference — you're reading intent out of
prose — so the app turns every change your result implies into a *proposal* parked on the **Changes**
page, where the human approves or rejects each one. Approving runs the same merge the app held back;
rejecting leaves the posting untouched.

Two consequences for how you report:

- **Report what the mail says, not what you think the tracker should end up as.** A human reads each
  proposal as a sentence ("Stage: Applied → Interviewing", "Adds 2 interview rounds"), so precise,
  minimal records read well and speculative ones are obvious — and get rejected.
- **Re-syncing is safe and expected.** A proposal that's still pending is *refreshed* by a later sync
  (learning about a third round updates the existing card rather than stacking a second one), and a
  change that's already been approved produces nothing on the next run.

A company already on the tracker keeps **its** stored spelling — your `company` value matches it (the
match is on the canonical key, so casing and suffixes don't matter) but never renames it. Still send
the canonical brand form: it's what a company the tracker hasn't seen yet gets created as.

Interview mail is matched against the postings already **in the interview stage** for that company —
if the human is interviewing at Acme, a scheduling email lands there rather than being offered
against every earlier-stage Acme posting. Keep `company` canonical and `role` as close to the
tracker's title as the email lets you; that's what makes the match unambiguous.
