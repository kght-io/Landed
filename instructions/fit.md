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

Produce, per posting: a **verdict for every criterion in the rubric**, the **main gaps** (each
tagged `hard` or `soft`), and a **leveling call**.

## Verdicts — judge the criteria, don't invent a score

**Do NOT send a `fitScore`.** The app computes the score from your verdicts. That is deliberate: a
number you produce can't be audited ("why is this a 62?"), can't be re-weighted without re-running
you over everything, and can't be corrected. Per-criterion verdicts can be all three — and each one
is a labelling target, so my corrections become the eval set that tunes this job.

`getContext` hands you the **rubric** — each criterion's `key`, `type`, and a `definition` telling
you how to judge it. Answer every one:

| verdict | means |
| --- | --- |
| `met` | clearly satisfied |
| `partial` | partly, or a stretch |
| `unmet` | clearly not satisfied |
| `unclear` | the JD doesn't say enough to tell |
| `na` | the criterion doesn't apply to this posting |

**`type: "gate"` criteria VETO** — an `unmet` there drops the posting whatever the rest score. So on
a gate, reserve `unmet` for a clear, primary miss; anything arguable is `partial`, which costs
nothing. That asymmetry is on purpose: a wrongly-kept posting costs me one glance, a wrongly-dropped
one I never see again.

`unclear` is a real answer, not a cop-out — it scores low but not zero, and it's the signal that
routes a posting to me instead of being auto-decided. Use it when the JD genuinely doesn't say.

Give **`evidence`** (the line from the JD or résumé you're judging against) and **`confidence`**
(0–100, your own) on every verdict. Evidence is what makes a wrong verdict correctable rather than
just wrong.

## Output
Hand the result back with the **`submitJobResult` MCP tool** — `type: "fit"`, `jobId` = the
job's id, and `records` = one rich object per posting. **Give real detail, not one-liners.**

```json
[
    {
      "id": 1234,
      "company": "Stripe",
      "role": "Staff Software Engineer",
      "verdicts": [
        { "criterion": "location", "verdict": "met", "confidence": 95, "evidence": "Posting says NYC or US-remote" },
        { "criterion": "yoe-floor", "verdict": "met", "confidence": 90, "evidence": "8+ yrs vs a 5-year floor" },
        { "criterion": "role-discipline", "verdict": "met", "confidence": 88, "evidence": "Backend/distributed platform team" },
        { "criterion": "level-match", "verdict": "partial", "confidence": 75, "evidence": "Staff at a rigorous-leveling co — a rung above my baseline" },
        { "criterion": "must-have-coverage", "verdict": "partial", "confidence": 70, "evidence": "Has Go and distributed systems; no Kafka in the résumé" },
        { "criterion": "domain-relevance", "verdict": "met", "confidence": 85, "evidence": "Payments ledger — adjacent to ads/risk at scale" },
        { "criterion": "seniority-signal", "verdict": "met", "confidence": 80, "evidence": "Wants cross-team technical leadership" },
        { "criterion": "comp-floor", "verdict": "na", "confidence": 99, "evidence": "No range posted" }
      ],
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
- `verdicts` — **required**, one per rubric criterion: `{ criterion, verdict, confidence, evidence, reasoning? }`.
  `criterion` must be a `key` from the rubric in `getContext` — an invented one is discarded.
- `fitScore` — **do not send it.** The app computes it from `verdicts`.
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
