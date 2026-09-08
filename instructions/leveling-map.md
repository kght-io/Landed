# Leveling map: what a company's rungs actually mean

Work out, for one company, **which seniority band each of its IC engineering rungs sits in — and
which titles those rungs appear under in real postings.** Store it with `upsertCompanies`'
`ladderMap`.

This runs **once per company** and is cached. It never looks at a posting. A board can carry 90
postings and the question "is L6 senior here?" has one answer for all of them, so researching it per
posting would be 90 searches to learn one fact.

## Why this job exists

The scan used to decide seniority by **substring-matching a job title** against a per-company
`targetTitles` list written once when the company was added and never revisited. Its strictness was
therefore arbitrary:

- Airbnb's list was `["Senior"]`, so every **Staff** role it found was dropped as out-of-level.
- Anthropic's was `["Senior","Staff","Lead"]`, which dropped every unlevelled title it posts —
  `Software Engineer, Research Infrastructure`, `Performance Engineer`, and most of its board.
- Jane Street's was empty and Cursor's was null, which filtered **nothing at all**.

150 postings died at that gate in four weeks, many of them roles worth seeing. The fix is to know the
ladder instead of guessing at the words.

## Not the same job as `leveling.md`

| | `leveling` | `leveling-map` (this one) |
| --- | --- | --- |
| Collects | levels.fyi bar geometry, normalized 1–10 | rung → posting titles → seniority band |
| Used by | the Lvl popover's comparison chart | **the scan's level gate** |
| If it's wrong | a chart looks off | good postings get dropped |

They are stored in different columns (`leveling` vs `ladder_map`) and neither reads the other. Do not
run the levels.fyi scraper for this job — it answers a different question, slowly.

## What to do

**1. State what you already know.** Most big-tech ladders are public and well documented — Amazon
L4–L8, Meta E3–E7, Google L3–L7. Write down the rungs, the titles each appears under in postings, and
the band you'd assign.

**2. Confirm it with a web search.** Your recollection is reliable for large, stable ladders and
unreliable for startups, AI labs, and anywhere that renamed its levels. Search for the company's
ladder and for its actual job postings. Then record which source won:

- `"model"` — you recalled it and found nothing either way.
- `"search"` — the web contradicted you and the web won.
- `"model+search"` — confirmed.

**3. Record ambiguity as ambiguity.** If sources disagree about whether a bare *Member of Technical
Staff* is senior or staff, put **both** bands on that rung. This is not hedging: bands widen the
gate and never drop a posting, so recording both keeps the role visible while recording one at random
can silently delete it. **Do not pick one to look decisive.**

**4. Give the titles as they appear in postings.** `titles` is the join key — the scan only ever sees
a title, never a rung name. Matching is by containment, so give the bare title (`"Senior Software
Development Engineer"`) and not a decorated one (`"Senior Software Development Engineer, Sponsored
Products"`). Include the abbreviations the company actually uses (`"Senior SDE"`, `"Sr. SWE"`).

**5. Always write a `reason`.** There is no ground truth behind any of this. The reasoning IS the
artifact: without it a wrong mapping can't be distinguished from a right one and there is nothing to
correct against. **A map with no reason is discarded on write.**

## Bands

`junior` · `mid` · `senior` · `staff` · `principal` · `distinguished`

Coarse on purpose — finer distinctions can't be recovered reliably from a job title, and a band that
can't be assigned consistently is worse than none.

## Write it

Call **`upsertCompanies`** with just the `ladderMap` field (matched by name; only this field changes
— don't clobber fetch config or titles):

```json
{ "companies": [{
  "name": "Amazon",
  "ladderMap": {
    "rungs": [
      { "rung": "L5", "titles": ["Software Development Engineer II", "SDE II"], "bands": ["mid"] },
      { "rung": "L6", "titles": ["Senior Software Development Engineer", "Senior SDE"], "bands": ["senior"] },
      { "rung": "L7", "titles": ["Principal Engineer"], "bands": ["principal"] }
    ],
    "source": "model+search",
    "reason": "levels.fyi and Amazon's own postings agree: L6 posts as Senior SDE, L7 as Principal Engineer."
  }
}]}
```

An unlevelled ladder, where the ambiguity is the point:

```json
{ "companies": [{
  "name": "Anthropic",
  "ladderMap": {
    "rungs": [
      { "rung": "MTS", "titles": ["Member of Technical Staff", "Software Engineer"], "bands": ["senior", "staff"] },
      { "rung": "Senior MTS", "titles": ["Senior Software Engineer", "Staff Software Engineer"], "bands": ["staff"] }
    ],
    "source": "model+search",
    "reason": "Most IC roles post unlevelled. Sources disagree on whether a bare MTS is senior or staff, so both are recorded rather than guessing."
  }
}]}
```

## If you genuinely can't establish a ladder

Small startups often have none — a flat "Software Engineer" for everyone. Say so in the company's
`notes` and **leave `ladderMap` unset**. Do not invent rungs, and do not write a map with a guessed
band just to have written something: a map is read as a real answer, so a fabricated one drops
postings on nonsense, which is strictly worse than the gate having nothing to go on.

This job has **no `submitJobResult` ingest** — you write directly via `upsertCompanies`, same as
`watchlist-add` and `leveling`.
