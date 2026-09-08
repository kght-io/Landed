# Job: tailoring

Tailor my base resume to each queued posting so it's ready to submit.

**How to tailor lives in my `tailorGuidance`, not in this file.** This playbook is the plumbing —
what to read, the helper that writes the files, what shape to hand back. See step 1.

## What to read
1. The **JD** for each posting in `params.postings` (each has an `id`, `company`, `role`, `jd`, and
   sometimes a `url`). **`jd` is normally already filled** — carried over from the scan / fit step,
   so you shouldn't need to fetch. Only fetch it from the `url` if `jd` is empty. Keep each
   posting's `id` — you echo it back in the result.
2. My **base resume** — the ONLY source. Never edit it; copy from it. Its absolute path comes back
   from `getContext` as `paths.baseResume` (and the folder to write into is under `paths.resumeDir`).
   **Use those paths verbatim.** Don't go looking for the asset root in the source or the environment
   — `getContext` is where it lives.
3. The posting's prior **fit** record — it **arrives on the job**, as `params.postings[].fit`
   (`score`, `level` = the leveling call, `recommendation`, `gaps`). Use it to steer the edits: the
   `gaps` say which bullets need work and which claims you must not make. **Don't go querying the
   database for it** — if the key is absent the posting was never scored, and you steer off the JD
   alone. That's the whole story; there is nothing further to look up.
4. My **profile** from `getContext` — this carries my **`tailorGuidance`**, which is the tailoring
   method itself (step 1). There is no per-job note field, so always read it. The same call carries
   `paths` (above), so one `getContext` covers both.

## Steps (per posting) — do BOTH of these. Neither is optional.

1. **Tailor the résumé exactly as my `tailorGuidance` says.** That guidance from `getContext` IS
   the method for this job — the plan to write before editing, the zones to work, how far to rewrite
   a bullet, and the truthfulness bar. Read it before you touch anything and satisfy every part of
   it; a tailor that skips a part of it is incomplete, not merely lighter.

   This playbook deliberately owns only the plumbing, because the method is mine to tune and I
   version it so I can tell which version earned callbacks. Don't reason about *which* version you
   have — there is one guidance and it's the current one. (If it is ever blank, use your own
   judgement.) Whatever it tells you to explain about an edit, explain it in the `diff` comments
   under Output — that's the only place your reasoning is recorded.

2. **Produce the files with `buildTailoredResume`.** Express your tailoring as `{find, replace}`
   pairs — `find` copied **verbatim** from `readBaseResumeText()`, `replace` your tailored line.

   ```
   1. readBaseResumeText()            → the base résumé as visible text.
                                        Copy your `find` strings verbatim from THIS output.

   2. buildTailoredResume({ slug, edits })
        slug  — the one from `params`, unchanged
        edits — [{ "find": "<verbatim base line>", "replace": "<tailored line>" }, ...]
      → writes resume.docx (+ resume.pdf) into the app's slug folder.
   ```

   Both are **`landed-local` MCP tools**, not shell commands — there are no paths to pass. If
   `landed-local` isn't among your tools, this checkout hasn't built it: say so in your result.

   The tool enforces its own rules and **tells you what to do when one fires** — read the `error` or
   `note` it returns and follow it. You don't need to memorise them here. Two facts it can't tell
   you, because they look like bugs and aren't:
   - **The slug is the app's**, a versioned path like `acme-senior-123/v2`. Pass the one in `params`
     and echo it back unchanged; each redo is a new `v<N>` folder, so nothing is overwritten.
   - **The base résumé renders to 3 pages. That is correct** — don't "fix" it.

### Redos (when the task carries a prior conversation)

The task may include a **"Prior tailor conversation"** — your earlier version notes interleaved
with my redo requests (`[redo] …`). When present, this is version **v2+**: read the whole
thread, then **act on the latest redo request** specifically (e.g. "lead with the ledger rewrite").
Start fresh from the **base resume** (never from a prior version's file); produce a complete
tailored resume in the new `v<N>` folder, and in your `note` say what you changed **in response to
the redo**.

## Output
Save the tailored resume to `resume/<slug>/` as before (the resume files stay on disk), then
hand the metadata back with the **`submitJobResult` MCP tool** — `type: "tailoring"`, `jobId` =
the job's id, and `records` = one object per tailored posting:

```json
[
  { "id": 1234, "company": "Stripe", "role": "Staff Software Engineer",
    "slug": "stripe-staff-123/v1",
    "diff": [
      { "type": "del", "text": "Built internal tooling for the data team" },
      { "type": "add", "text": "Built distributed payment-ledger services handling 10k tps",
        "comment": "mirrors the JD's 'distributed systems at scale' must-have" },
      { "type": "add", "text": "Skills: Go, Kafka, Postgres, gRPC",
        "comment": "surfaces the exact stack the JD names (was buried lower)" }
    ] }
]
```

Field rules:
- `id`, `slug` — **echo `params.postings[].id` / `.slug` back exactly.** That's how the app matches
  the result to the posting and files this version. Don't invent either.
- `company`, `role` — for readability / fallback matching if `id` is missing.
- `note` — **omit it.** The `diff` comments are the rationale now.
- `diff` — **required.** A line-level diff of your tailored résumé against the base, in document
  order. You made the edits, so you know what changed and why. Each op:
  - `type` — `"del"` (a base line you removed/replaced) or `"add"` (a line you wrote).
  - `text` — the line's text (résumé content only; no markup).
  - `comment` — **on changed lines, the *why*** — the JD-driven reason for the edit (e.g. "mirrors
    the JD's 'event-driven architecture' requirement", "drops the mobile bullet the JD never asks
    for"). One short clause. The `comment`s are the only record of your reasoning, so together they
    must account for the **bullet decisions** and how each **hard gap** was handled. A diff whose
    changed lines are silent on the bullets signals they were never considered.

  Rules: diff against the **base** résumé (always — even on a redo you re-tailor from base, so the
  diff is tailored-vs-base, not vs the prior version). **Send only changed lines** — `add` and `del`.
  Don't re-emit unchanged `eq` context or blank lines: the app has the base résumé and fills the
  surrounding context itself, so copying it back is output you're paying for twice.

The app records the `slug` on the matching candidate (matched by `id`, falling back to company +
url/role) and moves it **Tailoring → Tailored** (still in discovery — applying is what graduates it
to the tracker) — then records and archives the job automatically.
