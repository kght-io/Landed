# Job: watchlist-scan (one company per job)

Check **one watchlisted company** for new postings. Each `watchlist-scan` job carries
**`params.company`** (the company to scan) — these jobs come from the app's "Scrape watchlist"
button, which queues one per company not scraped in over 3 days. **Do NOT self-initiate watchlist
scans** and do NOT call `scanWatchlist` for the whole board — only work the queued per-company jobs.

Each company has a `fetchMethod` that decides who fetches it and how — the app does the heavy ATS
download (it can swallow a 498-job board you can't), you do the careers-page reads and all the judgment.

## How fetching works (`fetchMethod`)
- **api** — the app hits the ATS JSON (Greenhouse/Ashby) server-side, filters by department +
  location, and returns the shortlist. You just read the result. (Used when the ATS JSON is the
  cleanest source — structured location.)
- **careers-get** — **you** do a plain GET of `careersUrl`; the jobs are already in the HTML.
  Filter from the response text. Cheap, no browser.
- **browser** — **you** open `careersUrl`, let JS render, apply the filters (URL params or
  on-page dropdowns), read the result. Heaviest; only when a GET returns nothing useful.

`fetchRecipe` holds the per-company steps (which filters to set, what to exclude, where the
level comes from). It's declarative — no click coordinates.

This is the **glance** step — a cheap, superficial pass on **title + location only, NO JD**.
The JD is read later, once, in the fit assessment. So never open a JD here; just route each
candidate by what the title + location tell you.

## The level call and the ranking (this is the important part)

The app used to decide seniority here with a **substring match** against a per-company title list,
and it was silently throwing away good roles: Airbnb's list was `["Senior"]`, so every **Staff** role
it posted was dropped; Anthropic's dropped every **unlevelled** title it posts. 150 postings died
that way in four weeks. That gate is gone. **You** make the level call now, and you have what the
regex never did: the company's own ladder.

### `bands` — what level is this, really

`scanCompany` returns the company's **`ladderMap`** alongside the shortlist: each rung, the titles it
appears under in real postings, and the seniority band(s) it maps to. Read the posting's title
against it and report the band(s) in `bands`.

**When the ladder is ambiguous, give every band it might be — do not pick one.** A bare *Member of
Technical Staff* that could be senior or staff gets `["senior","staff"]`. This is not indecision:
listing both KEEPS the posting, while collapsing to one can silently delete a role I'd have wanted.
Being decisive here costs me jobs.

**If `ladderMap` is null, or the ladder can't place the title, omit `bands` and do not drop on
level.** No mapping means you have nothing to judge against — that is a reason to keep, never a
reason to cut. Only `drop` on level when the ladder actually says the role is outside my band.

### `rank` — what should I read first

Rank each company's board 1..n (1 = read this first) and send the numbers **in one call**, so they
mean something relative to each other. Rank on:

1. **Level fit** — squarely in my band beats above or below it.
2. **Discipline fit** — how well it matches my `includeDisciplines` (backend, fullstack, platform,
   infrastructure, distributed systems) and my background.

A title with no recognizable SWE signal at all ranks **low** — it is not dropped. "No positive
signal" is the absence of evidence, not evidence of a bad role, and a low rank is something I can
see and correct while a drop is invisible.

Rank everything you keep. An unranked posting sorts last, which is not the same as ranking it last.

## Steps
1. **Claim the job** (`claimJob(id)`), then read **`params.company`**.
2. Call **`scanCompany(params.company)`** — it returns this one company's plan. Branch on `status`:
   - **`ok`** (api): the app already fetched + coarse-filtered. Read its `matched` shortlist
     (title, location, url, atsId). Don't pull JDs.
   - **`manual`** (careers-get/browser): fetch the listing yourself using the returned
     `fetchMethod` + `careersUrl` + `fetchRecipe`. Apply the recipe's filters and excludes.
   - **`unsupported`**: no method/slug yet — skip the glance and flag it for research (don't guess).
3. **Glance** every candidate (title + department, your judgment) and assign a verdict:
   - **high** — clearly an IC SWE role in my band that fits the profile.
   - **low** — plausible but you're unsure from the title alone.
   - **drop** — clearly not a match → discarded.
   high **and** low both land in my "Scan results" tab for me to triage into Fit myself (I decide what
   to assess); only **drop** is discarded. Nothing is auto-queued to fit.
   Calibrate against my **profile** from `getContext` (`profile`: level, include/exclude disciplines, locations).
4. **Call the level** (`bands`) and **rank the board** (`rank`) — see below. Both go on the same
   `submitGlance` call as the verdict.
5. Submit the verdicts with **`submitGlance`** (below).
6. **Close the job**: call `submitJobResult({ type: "watchlist-scan", jobId, records: [] })` — this
   marks the job ingested and stamps the company's "Last scraped" so it isn't re-queued. (The
   verdicts already went via `submitGlance`; the empty `records` here just closes the job.)

## Common excludes
**Title excludes are now enforced by the app on `submitGlance`, for every fetch method** — it
auto-drops Engineering Manager / TPM / any manager or director (IC only), recruiters, Security,
Sales / Support / Solutions / Data-science "Engineer" titles, hardware/IT, and junior/intern,
even if you sent `high`. So you don't have to be perfect here, but still prefer dropping them
yourself to keep submissions clean. **Location is still yours on manual fetches:** drop **non-US**
(Canada/UK/etc.) unless the posting also lists a US / remote-US option — the app only location-filters `api`.

## Output — submit your glance verdicts
Call **`submitGlance`** with one object per candidate, carrying the verdict, the level call
(`bands`) and the ranking (`rank`). For **api** companies pass the `atsId` (from the scan
shortlist); for **careers-get/browser** companies you fetched, pass `company` + `url` + `title`
(the app creates the scanned row).

**high** and **low** both land in my **Scan results** tab for me to triage; only **drop** is
discarded. **Nothing is auto-queued to fit** — I decide what gets assessed. No application is
created either; that only happens when I apply (see the discovery-vs-tracker note in `README.md`).

```json
{ "verdicts": [
  { "company": "Anthropic", "atsId": "7462541", "glance": "high",
    "bands": ["senior", "staff"], "rank": 1 },
  { "company": "Anthropic", "atsId": "7462599", "glance": "high",
    "bands": ["staff"], "rank": 2 },
  { "company": "Anthropic", "atsId": "7462610", "glance": "low",
    "bands": ["staff"], "rank": 3 },
  { "company": "Anthropic", "atsId": "7462620", "glance": "drop",
    "reason": "mobile — outside my disciplines" },
  { "company": "Stripe", "url": "https://stripe.com/jobs/listing/...",
    "title": "Backend Engineer", "location": "Seattle", "glance": "high", "rank": 1 }
] }
```

Note the first entry: two bands because the ladder genuinely can't separate them, and that is the
right answer — not a worse one than picking `staff`.

Send a company's whole board in one call so the ranks are relative to each other.
