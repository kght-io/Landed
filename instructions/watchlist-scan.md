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

## Steps
1. **Claim the job** (`claimJob(id)`), then read **`params.company`**.
2. Call **`scanCompany(params.company)`** — it returns this one company's plan. Branch on `status`:
   - **`ok`** (api): the app already fetched + coarse-filtered. Read its `matched` shortlist
     (title, location, url, atsId). Don't pull JDs.
   - **`manual`** (careers-get/browser): fetch the listing yourself using the returned
     `fetchMethod` + `careersUrl` + `fetchRecipe`. Apply the recipe's filters and excludes.
   - **`unsupported`**: no method/slug yet — skip the glance and flag it for research (don't guess).
3. **Glance** every candidate (title + location, your judgment) and assign a verdict:
   - **high** — clearly a senior+ SWE IC role that fits the profile.
   - **low** — plausible but you're unsure from the title alone.
   - **drop** — clearly not a match → discarded.
   high **and** low both land in my "Scan results" tab for me to triage into Fit myself (I decide what
   to assess); only **drop** is discarded. Nothing is auto-queued to fit.
   Calibrate against my **profile** from `getContext` (`profile`: level, include/exclude disciplines, locations).
4. Submit the verdicts with **`submitGlance`** (below).
5. **Close the job**: call `submitJobResult({ type: "watchlist-scan", jobId, records: [] })` — this
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
Call **`submitGlance`** with one object per candidate. For **api** companies pass the `atsId`
(from the scan shortlist); for **careers-get/browser** companies you fetched, pass `company` +
`url` + `title` (the app creates the scanned row). The app routes each: **high** sends the
candidate to the **fit queue** **and creates a fit job** (it carries the URL — you fetch the JD
when you run that fit job), **low** → review, **drop** → discarded. (No application is created —
that only happens when you apply; see the discovery-vs-tracker note in `README.md`.)

```json
{ "verdicts": [
  { "company": "Hudson River Trading", "atsId": "7462541", "glance": "high" },
  { "company": "Jane Street", "atsId": "2053", "glance": "low" },
  { "company": "Stripe", "url": "https://stripe.com/jobs/listing/...", "title": "Backend Engineer", "location": "Seattle", "glance": "high" }
] }
```

You don't queue fit jobs yourself anymore — `submitGlance` does it for every **high**. The
separately-scheduled fit step then picks them up (see `fit.md`).
