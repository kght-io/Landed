# Job: fit

Assess how well I fit each posting, so I can decide to tailor, apply as-is, or skip.

**How to judge fit lives in my `fitGuidance`, not in this file.** This playbook is the plumbing —
what to read, which tools to call, what shape to hand back. See "What to assess".

## What to read
1. The **JD** for each posting in `params.postings` (each has an `id`, `company`, `role`, a `jd`,
   and/or a `url`). **Use `params.jd` when it's non-empty** — it's usually pre-filled from the
   scan, so don't re-fetch. Only **fetch the JD from `url`** when `jd` is empty (e.g. companies
   CoWork fetched itself). Keep each posting's `id` — you echo it back in the result.
   - **As soon as you have the JD, save it** with the **`savePostingJd(id, jd)` MCP tool** (one
     call per posting). This stores the JD on the posting so the later tailoring job reuses it
     instead of re-fetching from the link. Do this even when `params.jd` was already filled —
     it's a cheap idempotent write. It's a **separate** call from `submitJobResult`; don't try to
     pass the JD back inside the fit result.
2. My **base resume**: `resume/resume-ref.docx`.
3. My **profile** from `getContext`. It carries my **`fitGuidance`** — see below — plus my **level
   baseline** (my current / most-recent level and how long I've held it), my **target-level rule**,
   and my disciplines / background. My base resume (above) is the fuller record.

## What to assess (per posting)

**`fitGuidance` from `getContext` IS this job's method** — how I want gaps weighted, how the
leveling call is made, and how strict to be. Read it and follow it in full. It is the substance of
this job, not a footnote to it: this playbook deliberately owns only the plumbing (what to read,
what to call, what shape to hand back), because the judgment is mine to tune and I version it so I
can tell which version earned callbacks. Don't reason about *which* version you have — there's one
guidance and it's the current one. (If it is ever blank, use your own judgement.)

Produce, per posting: the **main gaps** (each tagged `hard` or `soft`), a **leveling call**, and a
**fitScore** (0–100). The exact shape of each is under Output below; `fitGuidance` decides what
goes in them.

## Output
Hand the result back with the **`submitJobResult` MCP tool** — `type: "fit"`, `jobId` = the
job's id, and `records` = one rich object per posting. **Give real detail, not one-liners.**

```json
[
    {
      "id": 1234,
      "company": "Stripe",
      "role": "Staff Software Engineer",
      "fitScore": 72,
      "levelMatch": { "call": "stretch", "why": "Staff at a big rigorous-leveling co; against my level baseline I'd more likely land one rung lower." },
      "recommendation": "tailor",
      "strengths": [
        "8 yrs backend incl. high-scale distributed services",
        "Owned a payments-adjacent ledger rewrite end to end"
      ],
      "gaps": [
        { "text": "payments/fintech domain", "severity": "hard", "detail": "JD wants 3+ yrs payments systems; my experience is adjacent (ledger) but not core payments." },
        { "text": "staff-scope cross-org influence", "severity": "soft", "detail": "JD expects driving roadmaps across teams; my scope has been single-team lead." }
      ],
      "summary": "Strong backend match; level is a reach and payments domain is the real gap."
    }
]
```

Field rules:
- `id` — **copy `params.postings[].id` back exactly, unchanged.** This is how the app matches your
  result to the right posting. Don't omit it, don't invent one — just echo the number you were given.
- `fitScore` — 0–100; `fitGuidance` says how to weight it.
- `levelMatch.call` — exactly one of `match` · `stretch` · `under-leveled`; `levelMatch.why` — one line.
- `recommendation` — exactly one of `tailor` · `apply` · `skip`.
- `strengths` — the few that matter (array of strings); omit if none stand out.
- `gaps` — array of `{ text, severity: "hard"|"soft", detail }`; `detail` explains *why* it's a
  gap (JD ask vs. my resume). Keep to the 2–4 that decide the screen. Empty array if none.
- `summary` — one line tying it together.

(The JD is **not** a result field — save it separately with `savePostingJd(id, jd)`, see "What to
read" above.)

The app matches each record to the candidate by its `id` (falling back to company + url/role if the
id is missing), stores the assessment, and moves it `fit queue → assessed` (it stays
in discovery — the candidate, not the tracker) — then records and archives the job automatically.
Each assessment is kept as a version, so re-scoring never loses the earlier one.

## Redos (when the task carries a prior conversation)

The task may include a **"Prior fit conversation"** — your earlier assessment(s) interleaved with
my redo requests (`[redo] …`). When present, read the whole thread and **re-assess to
address the latest redo request** specifically (e.g. "weight leadership scope over IC depth"), then
submit a fresh full assessment as usual. The app stores it as the next version.
