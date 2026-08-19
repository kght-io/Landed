// Lifts the two judgment blocks out of the profile blob into their own versioned rows — v1 of
// `fit` and of `tailoring`. Before this, `fitGuidance` / `tailorGuidance` were plain fields on the
// app_config "profile" JSON; an install that had tuned them must keep that text as its baseline, or
// every callback recorded so far would be attributed to a prompt nobody can read back.
//
// Takes the RAW better-sqlite3 handle, like ./backfill-prep-assets.ts: it's called from inside
// ./index.ts's connection() while the Drizzle `db` is still being constructed, so importing that
// would be a cycle.
//
// Idempotent per feature — it skips any feature that already has a row, so a re-run can never drag
// the active version back to v1.
import type Database from "better-sqlite3";

// Ship-with defaults — the WHOLE judgment for each job, carved out of the playbooks so it can be
// versioned and experimented on. instructions/fit.md and instructions/tailoring.md keep only the
// workflow (which tool to call, the helper's mechanics, the result schema) and defer to these.
// They live HERE, in the leaf that boot calls, rather than in ./prompts.ts (which imports the
// Drizzle `db` and so can't be reached from inside connection()); ./prompts.ts re-exports them.
//
// Written in the second person to the agent, and SELF-CONTAINED: the agent reads this through
// getContext, so it can't refer to "the section below" in a file it may not have open.
export const SEED_FIT_BODY = `What I act on is **(1) the main gaps** and **(2) the leveling call** — the score is secondary. Gaps and level drive my decision to tailor, apply as-is, or skip. Judge against what you actually know about me, not keyword overlap.

**Main gaps — the primary output.** The few gaps that actually decide *this* screen, each tagged **hard** or **soft**:
- **hard** = a concrete requirement I don't clearly meet (specific tech/stack, domain, years, a credential, on-site/location).
- **soft** = scope/leadership/ambiguity/communication-type expectations I'd have to stretch into.

Keep it to the **2–4 that matter** — not an exhaustive checklist. If there's no real gap, say so plainly.

**Leveling.** Judge the posting against my level baseline and target-level rule (both in this profile), never a hardcoded one. The level I should target typically depends on company size:
- **Bigger / rigorous-leveling companies** (FAANG-scale, large public, strict ladders) → hold at the level that maps to my baseline; the rung above is a stretch, especially when I've only recently reached my current level.
- **Smaller companies / startups** (title inflation, broader scope per IC) → the rung above my baseline is a fair target.

Call it **match** (lines up with where I'd land at this company size), **stretch** (a level above where I'd realistically land — apply, but expect a harder bar), or **under-leveled** (below my level; likely a step back). One line on why, grounded in company size + my baseline.

**Score.** A rough sortable signal, weighted: must-have **hard-gap** coverage (most), then **leveling match**, then domain overlap. Don't over-think it. Be honest — a weak or partial match is a low score, not a stretch.`;

export const SEED_TAILOR_BODY = `Reframe my real experience to mirror the JD and clear ATS — **never invent** experience.

A tailor that only edits the summary and skills lines is **incomplete**. The experience bullets must be **actively reworded to mirror the JD's exact terms** (truthfully), not merely considered. Reframing bullets into the JD's vocabulary is the default; leaving a bullet untouched is the rare exception.

**1. Write the tailoring plan first** — before editing, because it's the audit trail:
- **Keywords to mirror** — the exact languages, frameworks, systems, and domain terms the JD names that I can *truthfully* claim.
- **Lead bullets** — which existing bullets are most relevant to THIS JD (they move to the top of their role/section).
- **Downplay** — which bullets are least relevant (they move down — never delete real experience, only reorder).
- **Hard gaps** — each hard gap from the fit record + how you'll address it honestly (reframe an adjacent real bullet, or leave it; never fake it).

**2. Work all four zones for every posting** — summary, skills, gaps, and bullets all normally change:
- **a. Summary / headline** — retitle to the posting's level and reframe the 2–3 sentences around the JD's focus.
- **b. Skills lines** — reorder to lead with the JD's named stack; surface truthfully-held tools the JD calls out.
- **c. Experience bullets — reword to mirror the JD by default.** For each role, rewrite the bullets so they carry the JD's exact languages, frameworks, systems, and domain terms I can *truthfully* claim (same facts, JD vocabulary), and reorder so the JD-relevant ones lead. If the JD names a term my real work covers, the bullet should say it in the JD's words. **Keeping a bullet as-is is the exception** — allowed only when there is genuinely no truthful JD keyword to surface in it, and then say why.
- **d. Gaps** — apply the honest gap treatment from your plan.

**3. Stay truthful** — reprioritize and reword what I've actually done; never invent. Same facts, reframed; no new claims.

**4. Self-check before saving** — confirm: (i) every JD must-have keyword I can truthfully claim appears, **including inside the experience bullets** — not just the summary/skills lines; (ii) each role's bullets were reworded into the JD's vocabulary (or, for any bullet kept as-is, you said why no truthful keyword applied); (iii) nothing fabricated.

Keep the résumé **ATS-clean**: standard sections, no tables or graphics.`;

// The pre-carve-out defaults: three sentences of standing guidance that sat ON TOP of judgment the
// playbooks owned. Kept only so the v5 migration can recognize an install that never edited them and
// upgrade it in place. Don't reference these anywhere else.
export const LEGACY_SEED_FIT_BODY =
  "Weight leveling match and hard-gap coverage most; the score is secondary. Be honest — a weak or partial match is a 'low', not a stretch. Favor roles at or near my level and flag big level stretches. Call out any hard must-have I clearly lack.";
export const LEGACY_SEED_TAILOR_BODY =
  "Mirror the JD's exact terms — but only what I can truthfully claim; never invent experience. Lead with my most relevant bullets, keep them concrete and metric-driven, and address the fit record's hard gaps honestly. Keep the resume ATS-clean: standard sections, no tables or graphics.";

const SEEDS = [
  { feature: "fit", key: "fitGuidance", fallback: SEED_FIT_BODY },
  { feature: "tailoring", key: "tailorGuidance", fallback: SEED_TAILOR_BODY },
] as const;

// The judgment moved OUT of the playbooks and into these versioned rows. An install seeded before
// that move has an active version holding only the old three-sentence nudge, while the playbook it
// used to lean on no longer carries the rules — so without this the agent would quietly lose them.
//
// Two cases, both ending with "the active body contains the full judgment":
//   - the active body is still the untouched legacy default → rewrite it in place. Nobody authored
//     it, so there's no work to preserve and no reason to mint a version.
//   - it was edited → keep that version (it's what past results are attributed to) and activate a
//     new one carrying the full judgment. Losing the rules is the worse failure; the old text stays
//     readable in the picker so anything worth keeping can be folded into the next version.
export function adoptCarvedOutJudgment(sqlite: Database.Database): number {
  const legacy: Record<string, string> = { fit: LEGACY_SEED_FIT_BODY, tailoring: LEGACY_SEED_TAILOR_BODY };
  const active = sqlite.prepare("SELECT id, body FROM prompt_versions WHERE feature = ? AND active = 1");
  const at = new Date().toISOString();
  let changed = 0;

  for (const { feature, fallback } of SEEDS) {
    const row = active.get(feature) as { id: number; body: string } | undefined;
    if (!row || row.body.trim() === fallback.trim()) continue; // fresh seed already carries it
    if (row.body.trim() === legacy[feature].trim()) {
      sqlite.prepare("UPDATE prompt_versions SET body = ? WHERE id = ?").run(fallback, row.id);
      changed++;
      continue;
    }
    const next =
      ((sqlite.prepare("SELECT max(version) AS v FROM prompt_versions WHERE feature = ?").get(feature) as { v: number | null }).v ?? 0) + 1;
    sqlite.prepare("UPDATE prompt_versions SET active = 0 WHERE feature = ? AND active = 1").run(feature);
    sqlite
      .prepare("INSERT INTO prompt_versions (feature, version, label, body, active, archived, created_at) VALUES (?, ?, 'Full judgment', ?, 1, 0, ?)")
      .run(feature, next, fallback, at);
    changed++;
  }
  return changed;
}

// The baseline was originally seeded as v1, before we settled on v0 for "the prompt you inherited".
// Renumber it so the first version you author is v1. Deliberately narrow: only an untouched
// baseline (still labelled Baseline, and no v0 already present) moves, so a v1 someone actually
// wrote keeps its number.
export function renumberBaselineToV0(sqlite: Database.Database): number {
  const find = sqlite.prepare(
    "SELECT id FROM prompt_versions WHERE feature = ? AND version = 1 AND label = 'Baseline'" +
      " AND NOT EXISTS (SELECT 1 FROM prompt_versions p2 WHERE p2.feature = prompt_versions.feature AND p2.version = 0)",
  );
  let moved = 0;
  for (const { feature } of SEEDS) {
    const row = find.get(feature) as { id: number } | undefined;
    if (!row) continue;
    sqlite.prepare("UPDATE prompt_versions SET version = 0 WHERE id = ?").run(row.id);
    moved++;
  }
  return moved;
}

// Point pre-versioning results at v0, so the baseline shows up in the comparison as a named cohort
// instead of a null "Before versioning" row.
//
// Strictly conditional, because "applied" does NOT mean "the agent worked on it". Most applications
// were submitted as-is, and many never ran a fit job at all — attributing those to v0 would invent
// runs that never happened and, worse, would erase the untailored cohort that is the only honest
// control for whether tailoring helps. So: a fit score means the fit job ran; a resume_dir means the
// tailoring job ran; `historical` rows are hand-entered records of applications made before the app
// existed, and are never attributed to anything.
//
// The IS NULL guards make this safe to re-run and keep it from ever overwriting a real claim-time
// stamp.
export function backfillBaselineAttribution(sqlite: Database.Database): number {
  const v0 = sqlite.prepare("SELECT feature, id FROM prompt_versions WHERE version = 0 AND label = 'Baseline'").all() as {
    feature: string;
    id: number;
  }[];
  const idOf = (feature: string) => v0.find((r) => r.feature === feature)?.id;
  const fit = idOf("fit");
  const tailoring = idOf("tailoring");
  let n = 0;
  if (fit != null)
    n += sqlite
      .prepare(
        "UPDATE postings SET fit_prompt_version_id = ? WHERE fit_prompt_version_id IS NULL AND fit_score IS NOT NULL AND historical = 0",
      )
      .run(fit).changes;
  if (tailoring != null)
    n += sqlite
      .prepare(
        "UPDATE postings SET tailor_prompt_version_id = ? WHERE tailor_prompt_version_id IS NULL AND resume_dir IS NOT NULL AND historical = 0",
      )
      .run(tailoring).changes;
  return n;
}

export function seedPromptVersions(sqlite: Database.Database): number {
  const row = sqlite.prepare("SELECT value FROM app_config WHERE key = 'profile'").get() as { value?: string } | undefined;
  let blob: Record<string, unknown> = {};
  try {
    blob = row?.value ? (JSON.parse(row.value) as Record<string, unknown>) : {};
  } catch {
    blob = {}; // an unparseable blob is the fresh-install case as far as seeding is concerned
  }

  const has = sqlite.prepare("SELECT 1 FROM prompt_versions WHERE feature = ? LIMIT 1");
  // v0, not v1: this is the prompt the install INHERITED, not one anybody authored. Numbering it 0
  // keeps "v1" meaning "the first change I made" — and makes the baseline read as a baseline in the
  // callback comparison rather than as an experiment that happens to be first.
  const insert = sqlite.prepare(
    "INSERT INTO prompt_versions (feature, version, label, body, active, archived, created_at) VALUES (?, 0, 'Baseline', ?, 1, 0, ?)",
  );
  const at = new Date().toISOString();
  let seeded = 0;
  for (const { feature, key, fallback } of SEEDS) {
    if (has.get(feature)) continue;
    const stored = typeof blob[key] === "string" ? (blob[key] as string).trim() : "";
    insert.run(feature, stored || fallback, at);
    seeded++;
  }
  return seeded;
}
