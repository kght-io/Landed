# Job: tailoring

Tailor my base resume to each queued posting so it's ready to submit.

**How to tailor lives in my `tailorGuidance`, not in this file.** This playbook is the plumbing —
what to read, the helper that writes the files, what shape to hand back. See step 1.

## What to read
1. The **JD** for each posting in `params.postings` (each has an `id`, `company`, `role`, `jd`, and
   sometimes a `url`). **`jd` is normally already filled** — carried over from the scan / fit step,
   so you shouldn't need to fetch. Only fetch it from the `url` if `jd` is empty. Keep each
   posting's `id` — you echo it back in the result.
2. My **base resume**: `resume/resume-ref.docx` — the ONLY source. Never edit it; copy from it.
3. The posting's prior **fit** record if present (gaps + leveling call) — use it to steer the edits.
4. My **profile** from `getContext` — this carries my **`tailorGuidance`**, which is the tailoring
   method itself (step 1). There is no per-job note field, so always read it.

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

2. **Produce the files with the `tailor:docx` helper — do NOT hand-edit `document.xml`.** Word
   splits one visible sentence across several runs (the base résumé's "…built a 0" | "→" |
   "1 full-stack product…"), so string-searching the raw XML for a phrase misses any match that
   straddles a run — that's the trap that used to send this job probing byte offsets and corrupting
   the file. The helper matches against each paragraph's *concatenated* text, applies your edits,
   and renders the PDF with LibreOffice. Express your tailoring as `{find, replace}` pairs:
   `find` is text copied **verbatim from the base résumé** (read it with `--text`), `replace` is your
   tailored line.

   ```bash
   # 1. Read the base résumé as plain text to copy exact `find` strings from:
   npm run tailor:docx -- "$ASSET_ROOT/resume/resume-ref.docx" --text

   # 2. Write your edits, then build resume.docx + resume.pdf into the app's slug folder:
   #    edits.json = [{ "find": "<verbatim base line>", "replace": "<tailored line>" }, ...]
   npm run tailor:docx -- "$ASSET_ROOT/resume/resume-ref.docx" \
       "$ASSET_ROOT/resume/<slug>" edits.json
   ```

   Save to the **exact folder the app gives you** — `resume/<params.postings[].slug>/` — with the
   **generic filenames** the helper writes (`resume.docx`, `resume.pdf`). The app dictates the slug
   (a versioned path like `acme-senior-123/v2`); **don't invent your own** — pass the one in
   `params` and echo it back unchanged. Each redo is a new `v<N>` folder, so a prior version's files
   are never overwritten.

   Rules the helper enforces for you, so respect them:
   - **Every `find` must match, or nothing is written.** It prints `✓`/`✗ MISSED` per edit and exits
     non-zero if any `find` is absent. A miss means your `find` isn't verbatim — re-copy it from the
     `--text` dump (watch for the em-dash `→`, double spaces, and `&`), don't force it.
   - **The PDF comes from LibreOffice** (`soffice`), which reads the template's real formatting, so
     it matches the `.docx`. It builds in a temp dir and copies fresh files in (ASSET_ROOT is
     cloud-synced — an in-place overwrite corrupts). **Never** reach for
     `fpdf`/`reportlab`/`weasyprint`/`pandoc`; if `soffice` is genuinely missing, say so in your
     result rather than improvising a renderer.
   - **The base résumé renders to 3 pages — that is correct, not an overflow bug.** Don't "fix" it.

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
      { "type": "eq",  "text": "EXPERIENCE" },
      { "type": "del", "text": "Built internal tooling for the data team" },
      { "type": "add", "text": "Built distributed payment-ledger services handling 10k tps",
        "comment": "mirrors the JD's 'distributed systems at scale' must-have" },
      { "type": "add", "text": "Skills: Go, Kafka, Postgres, gRPC",
        "comment": "surfaces the exact stack the JD names (was buried lower)" }
    ] }
]
```

Field rules:
- `id` — **copy `params.postings[].id` back exactly, unchanged.** This is how the app matches your
  result to the right posting. Don't omit or invent it — echo the number you were given.
- `slug` — **echo `params.postings[].slug` back exactly** (the versioned `…/v<N>` folder the app
  told you to write to). Required. This becomes this version's entry in the résumé history.
- `company`, `role` — for readability / fallback matching if `id` is missing.
- `note` — **omit it.** Don't send a prose "what changed" summary — the app no longer shows it and
  you don't read it. The per-line `diff` `comment`s below ARE the rationale now; put your
  reasoning there, not in a note.
- `diff` — **required** (it's the only place your reasoning lives now, and the app renders it as the
  version's diff view; when omitted it falls back to a plain text diff it computes itself, with no
  rationale). An **annotated, line-level diff of your tailored résumé against the base résumé** — you
  produced the edits, so you know exactly what changed and why. An array of ops, **in document
  order**, each:
  - `type` — `"eq"` (unchanged line, for context), `"del"` (a base line you removed/replaced),
    or `"add"` (a line you wrote).
  - `text` — the line's text (résumé content only; no markup).
  - `comment` — **on changed lines (`add`/`del`), the *why*** — the JD-driven reason for the edit
    (e.g. "mirrors the JD's 'event-driven architecture' requirement", "drops the mobile bullet the
    JD never asks for"). Keep it to one short clause. Omit `comment` on `eq` context lines and on
    trivial reorders where the reason adds nothing. Since there's no longer a `note`, the `comment`s
    must collectively account for the **bullet decisions** (why a bullet was reworded/reordered — or,
    on a key bullet you deliberately kept, an `eq` line WITH a one-clause comment saying why) and how
    each **hard gap** was handled. A diff whose changed lines are silent on the bullets signals they
    were never considered.

  Rules: diff against the **base** résumé (always — even on a redo, you re-tailor from base, so the
  diff is tailored-vs-base, not vs the prior version). Include a little `eq` context around changes
  so the diff reads in order, like `git diff`. Don't include blank lines.

The app records the `slug` on the matching candidate (matched by `id`, falling back to company +
url/role) and moves it **Tailoring → Tailored** (still in discovery — applying is what graduates it
to the tracker) — then records and archives the job automatically.
