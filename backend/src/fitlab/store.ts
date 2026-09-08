import { eq } from "drizzle-orm";
import { db } from "../db";
import { fitCriteria, fitRuns, fitVerdicts } from "../db/schema";
import type { FitVerdictRow } from "../db/schema";
import { getConfig, setConfig } from "../db/config-store";
import { decide } from "./decide";
import { STARTER_CRITERIA, PROFILE_SEED, PROFILE_CONFIG_KEY } from "./seed";
import type { Criterion, CriterionType, Decision, Run, StageTrace, Verdict, VerdictRow } from "./types";

// The fit-labeling EVAL STORE — the rubric, the accumulated runs/verdicts, and the human labels that
// are the eval set, plus the deterministic Decide over them. Backend-only (server-side DB access), so
// nothing here ships to the browser.
//
// The standalone Fit Lab that WROTE this data (the /fit-lab page and the `fitlab-assess` job) is gone;
// what survives is the data layer and its read/label surface, so the labels stay queryable while fit
// itself is redesigned. That replacement is now here: `recordFitRun` is written from the LIVE fit
// job (backend/src/jobs/ingest.ts), so runs and their labels come from the real pipeline rather than
// a side lab.

const now = () => new Date().toISOString();

// ── Rubric (self-seeding) ──────────────────────────────────────────────────────────────────
export function listCriteria(): Criterion[] {
  let rows = db.select().from(fitCriteria).all();
  // Fill in any starter criterion this install doesn't have yet — NOT just on an empty table.
  // The rubric grows: `role-discipline` and `comp-floor` were added after the first six had already
  // been seeded, and an empty-table-only check would have left every existing install without them.
  // Keyed by `key`, so an existing row (and any weight you've tuned on it) is never overwritten.
  const have = new Set(rows.map((r) => r.key));
  const missing = STARTER_CRITERIA.filter((c) => !have.has(c.key));
  if (missing.length) {
    for (const c of missing) {
      db.insert(fitCriteria).values({
        key: c.key, label: c.label, type: c.type, weight: c.weight,
        definition: c.definition, active: true, sortOrder: c.sortOrder,
      }).onConflictDoNothing().run();
    }
    rows = db.select().from(fitCriteria).all();
  }
  return rows
    .map((r) => ({ key: r.key, label: r.label, type: r.type as CriterionType, weight: r.weight, definition: r.definition ?? "", active: r.active, sortOrder: r.sortOrder }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

// ── Recording an assessment ───────────────────────────────────────────────────────────────────
// The agent hands back one VERDICT PER CRITERION with its evidence; the score is computed here by
// decide(). The agent is never asked for a number, which is what makes the result auditable ("why
// is this a 62?"), re-weightable without re-prompting, and correctable — your override on a verdict
// recomputes the score.
//
// Every verdict row is also a labelling target. The rows where you disagree are the eval set.

export type IncomingVerdict = { criterion: string; verdict: string; confidence?: number; evidence?: string; reasoning?: string; requirement?: string };

const VERDICTS = new Set<Verdict>(["met", "partial", "unmet", "unclear", "na"]);

export function recordFitRun(input: {
  postingId: number | null;
  company: string;
  role: string;
  jd: string;
  model?: string;
  promptVersion?: string;
  verdicts: IncomingVerdict[];
}): { runId: number; score: number; decision: Decision } | null {
  const criteria = listCriteria();
  const byKey = new Map(criteria.map((c) => [c.key, c]));

  // Agent output is untrusted. A verdict naming a criterion that doesn't exist can't be scored, and
  // an unrecognized verdict value has no defined weight — both are DROPPED rather than coerced,
  // because a guessed value would land in the table the eval set is built from.
  const usable = input.verdicts.filter(
    (v) => byKey.has(v.criterion) && VERDICTS.has(v.verdict as Verdict),
  );
  // Nothing scorable means the agent didn't actually judge this posting; recording a run would put a
  // score on it anyway.
  if (!usable.length) return null;

  const ts = now();
  const runId = db
    .insert(fitRuns)
    .values({
      postingId: input.postingId,
      company: input.company,
      role: input.role,
      jd: input.jd,
      model: input.model ?? "",
      promptVersion: input.promptVersion ?? "",
      createdAt: ts,
    })
    .returning({ id: fitRuns.id })
    .get().id;

  const rows: VerdictRow[] = usable.map((v) => {
    const c = byKey.get(v.criterion)!;
    const id = db
      .insert(fitVerdicts)
      .values({
        runId,
        criterionKey: v.criterion,
        requirement: v.requirement ?? null,
        type: c.type, // snapshot: a later weight change must not rewrite what this run was judged under
        verdict: v.verdict,
        confidence: typeof v.confidence === "number" ? Math.max(0, Math.min(100, Math.round(v.confidence))) : null,
        evidence: v.evidence ?? null,
        reasoning: v.reasoning ?? null,
      })
      .returning({ id: fitVerdicts.id })
      .get().id;
    return {
      id, runId, criterionKey: v.criterion, requirement: v.requirement ?? null,
      type: c.type, verdict: v.verdict as Verdict,
      confidence: v.confidence ?? null, evidence: v.evidence ?? null, reasoning: v.reasoning ?? null,
      humanVerdict: null, humanNote: null, labeledAt: null,
    };
  });

  const { score, decision } = decide(criteria, rows);
  db.update(fitRuns).set({ score, decision }).where(eq(fitRuns.id, runId)).run();
  return { runId, score, decision };
}

// ── Profile (the resume the agent judges against) ─────────────────────────────────────────────
export function getProfile(): string {
  const v = getConfig(PROFILE_CONFIG_KEY);
  if (v != null) return v;
  setConfig(PROFILE_CONFIG_KEY, PROFILE_SEED);
  return PROFILE_SEED;
}
export function setProfile(text: string): void {
  setConfig(PROFILE_CONFIG_KEY, text);
}

// ── Runs ────────────────────────────────────────────────────────────────────────────────
function toVerdictRow(r: FitVerdictRow): VerdictRow {
  return {
    id: r.id, runId: r.runId, criterionKey: r.criterionKey, requirement: r.requirement,
    type: r.type as CriterionType, verdict: r.verdict as Verdict, confidence: r.confidence,
    evidence: r.evidence, reasoning: r.reasoning,
    humanVerdict: (r.humanVerdict as Verdict | null) ?? null, humanNote: r.humanNote, labeledAt: r.labeledAt,
  };
}

function assembleRun(runId: number): Run {
  const r = db.select().from(fitRuns).where(eq(fitRuns.id, runId)).get()!;
  const verdicts = db.select().from(fitVerdicts).where(eq(fitVerdicts.runId, runId)).all().map(toVerdictRow);
  return {
    id: r.id, postingId: r.postingId, company: r.company, role: r.role, jd: r.jd,
    model: r.model, promptVersion: r.promptVersion, score: r.score,
    decision: (r.decision as Run["decision"]) ?? null,
    stages: r.stages ? (JSON.parse(r.stages) as StageTrace[]) : [],
    createdAt: r.createdAt, verdicts,
  };
}

// Recompute the deterministic decision from the run's CURRENT verdicts (incl. human overrides) and
// refresh the run's score/decision + the Decide trace stage. Called after ingest and after each label.
function recomputeDecision(runId: number, criteria: Criterion[], priorStages: StageTrace[]): void {
  const verdicts = db.select().from(fitVerdicts).where(eq(fitVerdicts.runId, runId)).all().map(toVerdictRow);
  const { score, decision, detail } = decide(criteria, verdicts);
  const stages = priorStages.filter((s) => s.stage !== "decide");
  stages.push({ stage: "decide", ms: 0, artifact: { score, decision, ...detail } });
  db.update(fitRuns).set({ score, decision, stages: JSON.stringify(stages) }).where(eq(fitRuns.id, runId)).run();
}

export function getRun(id: number): Run | null {
  return db.select().from(fitRuns).where(eq(fitRuns.id, id)).get() ? assembleRun(id) : null;
}

export function listRuns(): { id: number; company: string; role: string; score: number | null; decision: string | null; pending: boolean; createdAt: string }[] {
  const verdictRuns = new Set(db.select({ runId: fitVerdicts.runId }).from(fitVerdicts).all().map((r) => r.runId));
  return db.select().from(fitRuns).all()
    .map((r) => ({ id: r.id, company: r.company, role: r.role, score: r.score, decision: r.decision, pending: !verdictRuns.has(r.id), createdAt: r.createdAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Apply (or clear, with null) a human override on one verdict — the LABEL — then recompute the run's decision.
export function setLabel(verdictId: number, humanVerdict: Verdict | null, humanNote?: string | null): Run | null {
  const v = db.select().from(fitVerdicts).where(eq(fitVerdicts.id, verdictId)).get();
  if (!v) return null;
  db.update(fitVerdicts).set({ humanVerdict, humanNote: humanNote ?? null, labeledAt: humanVerdict ? now() : null }).where(eq(fitVerdicts.id, verdictId)).run();
  const run = getRun(v.runId)!;
  recomputeDecision(v.runId, listCriteria().filter((c) => c.active), run.stages);
  return getRun(v.runId);
}

// How many verdicts carry a human label — drives the "unlocks at N labels" gates on the locked nodes.
export function labelStats(): { labeled: number; total: number } {
  const rows = db.select().from(fitVerdicts).all();
  return { labeled: rows.filter((r) => r.humanVerdict != null).length, total: rows.length };
}
