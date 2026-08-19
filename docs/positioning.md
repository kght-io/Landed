# Positioning — why the agent work is different

Working notes for marketing copy. Everything here is grounded in measured runs; provenance is at
the bottom. Keep it that way — a claim we can't defend from a trace doesn't belong in this file.

---

## The thesis: metered tools must be shallow. We aren't metered.

Every commercial résumé tailor faces the same economics: they **pay per token** and **charge a flat
monthly fee** ($14–50/mo across the market). Every token spent improving your résumé is margin they
lose. That single constraint shapes the entire product category:

- One model call per résumé, not a working session
- A generic template, because rendering your real file costs round trips
- Keyword matching against the job description, because grounding in your actual history costs context
- No audit trail, because explaining a change costs output tokens

None of that is laziness. It's a rational response to paying for depth out of a flat fee.

**Landed runs on your own Claude Code subscription.** The runner deliberately drops
`ANTHROPIC_API_KEY` so every run goes over your OAuth session rather than a metered API key
(`backend/src/agents/claude-code.ts`). We don't pay per résumé, so we don't have to ration the work.

> **The line:** Other tools bill per résumé, so they do the least work that ships.
> Landed runs on the Claude subscription you already have — so the agent does the work properly.

That's the whole argument. Everything below is evidence for it.

---

## What that buys, measured

A traced tailoring run made **~14 model calls** where a metered service makes **one**. Not padding —
each round trip does something the single call can't:

| The agent does | Which is only affordable because | A one-call tool instead |
|---|---|---|
| Reads your scored fit record — gaps, leveling call | it's a round trip nobody bills for | Infers from the JD text |
| Reads your real `.docx` and copies exact source lines | reading costs a call | Regenerates from a template |
| Rewrites bullets against your actual history | grounding costs context | Injects JD keywords |
| Renders through LibreOffice from your own file | rendering costs a call | Exports a generic PDF |
| Writes a line-by-line diff with a reason per change | explanation costs output tokens | Ships the file, no rationale |
| Verifies the output before reporting done | verification costs a call | Trusts the generation |

---

## The five differentiators

### 1. Grounded tailoring — it knows what you *don't* have

Before tailoring, a separate **fit job** scores the posting and records structured gaps (tagged hard
or soft), a leveling call, and a recommendation. The tailor reads that verdict first.

This is the one that matters most, and it's a **truthfulness** story, not a features story. A job
description says "Python/Django required." A tool with no ground truth writes Python and Django into
your résumé. Landed knows Django is a hard gap, so it names Python only where it's genuinely true and
never claims Django at all — then rewrites adjacent bullets to compete on what you *did* build.

**You can hand this résumé to a recruiter and defend every line of it.** That's not a claim
keyword-stuffing tools can make.

### 2. Your résumé, not a template

The agent reads the real `.docx`, matches text against each paragraph's concatenated content, applies
find/replace edits, and renders the PDF through LibreOffice from your own file. Your fonts, spacing,
and layout survive intact.

Most tools export their template. Landed edits *yours*.

### 3. Every change comes with a reason

Each version ships an annotated line-level diff — every changed line with a one-clause justification
tied to the job description ("mirrors the JD's event-driven requirement", "drops the mobile bullet
the JD never asks for").

You review edits instead of accepting a black box, and you can tell in ten seconds whether the agent
understood the role.

### 4. Redo as a conversation, not a re-roll

Not happy with v1? Leave a note — "lead with the ledger rewrite" — and the agent re-tailors **from
your base résumé**, honoring the request, into a new version folder. Prior versions are never
overwritten. The whole thread is replayed on each run, so it remembers what you asked for last time.

### 5. It measures what actually earns interviews

The judgment half of the tailoring prompt is versioned, and each posting records which version
produced its résumé. As callbacks land, they attribute back to the prompt version that earned them.

Over time the system learns which tailoring approach works **for you** — not which one benchmarks
well in general.

---

## Also true, worth saying

- **Local-first.** One SQLite database on your machine is the source of truth. Your résumé and
  history don't sit in someone else's product.
- **Every change is attributed.** Two actors edit the data — you, and the agent — and the app records
  which one did what.
- **It's the whole pipeline, not a résumé widget.** Discovery, fit, tailoring, applications,
  interviews, and prep in one stage-aware board. Tailoring is one stage of it.

---

## What we don't claim

Keep these out of the copy — overclaiming here is a liability, and the honest version is stronger:

- **Not "free."** It runs on a Claude subscription the user pays for separately.
- **No interview-rate claim.** The attribution machinery exists; the sample doesn't yet support a
  number. Don't publish one until it does.
- **No ATS-score claim.** We don't optimize for a scanner score, and saying so is a feature: the
  target is a human who can tell whether the résumé makes sense.
- **Slower than one-shot tools.** A tailor takes a couple of minutes, not seconds. That's the
  tradeoff for the work being real — say so plainly rather than hiding it.
- **Not a hosted service.** Today it's local-first with an optional private deployment.

---

## Provenance

- **Per-request costs and the ~14-call figure** come from one fully traced production run
  (`tailoring-app-912645`, 2026-08-18), reconstructed from the Claude Code session transcript.
  **n=1** — fine for illustrating shape, not for a headline statistic.
- **Aggregate spend** — 58 tailoring jobs over 2026-07-22 → 2026-08-19, $67.51 at list-price
  equivalent (not billed; runs go through the subscription).
- **Competitor pricing** — public pricing pages, August 2026: FastApply $14/$29/$49, Four-Leaf $20,
  PitchMeAI $22, Rezi $29, Resume Worded $19–49, Jobscan $49.95.
- **Cost-per-call estimate for one-shot tools** (~$0.04) is a token-math estimate, not sourced.
  Don't publish it as fact.

Re-measure after the params/getContext change (2026-08-19) — it removes ~9 of the 20 requests, so
the "~14 calls" figure will shift down. The argument doesn't depend on the exact number.
