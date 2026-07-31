import { eq } from "drizzle-orm";
import { db } from "../db";
import { fitCriteria, fitRuns, fitVerdicts } from "../db/schema";
import type { FitVerdictRow } from "../db/schema";
import { getConfig, setConfig } from "../db/config-store";
import { decide } from "@landed/shared/fitlab/decide";
import { STARTER_CRITERIA, PROFILE_SEED, PROFILE_CONFIG_KEY } from "@landed/shared/fitlab/seed";
import { FITLAB_MODEL, PROMPT_VERSION, normalizeVerdict, type FitRecord } from "@landed/shared/fitlab/task";
import type { Criterion, CriterionType, Run, StageTrace, Verdict, VerdictRow } from "@landed/shared/fitlab/types";

// The Fit Lab DATA layer — pure DB + the deterministic Decide. Imports nothing from lib/jobs (so the
// registry can import the ingest without a cycle). The LLM work happens in the agent (see task.ts/queue.ts).

const now = () => new Date().toISOString();

// ── Rubric (self-seeding) ──────────────────────────────────────────────────────────────────
export function listCriteria(): Criterion[] {
  let rows = db.select().from(fitCriteria).all();
  if (rows.length === 0) {
    for (const c of STARTER_CRITERIA) {
      db.insert(fitCriteria).values({
        key: c.key, label: c.label, type: c.type, weight: c.weight,
        definition: c.definition, active: true, sortOrder: c.sortOrder,
      }).run();
    }
    rows = db.select().from(fitCriteria).all();
  }
  return rows
    .map((r) => ({ key: r.key, label: r.label, type: r.type as CriterionType, weight: r.weight, definition: r.definition ?? "", active: r.active, sortOrder: r.sortOrder }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
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

// Create the run row up front (pending — no verdicts yet). The Fit Lab page polls this id while the agent
// works the queued job; the ingest fills in the verdicts. Returns the new run id.
export function createPendingRun(input: { postingId?: number | null; company: string; role: string; jd: string }): number {
  const run = db.insert(fitRuns).values({
    postingId: input.postingId ?? null, company: input.company, role: input.role, jd: input.jd,
    model: FITLAB_MODEL, promptVersion: PROMPT_VERSION, score: null, decision: null,
    stages: JSON.stringify([]), createdAt: now(),
  }).returning().get();
  return run.id;
}

// Fill a pending run with the agent's submitted verdicts (idempotent — replaces any prior verdicts for the
// run, so a redo is clean), then derive the trace stages + decision. This is what the job ingest calls.
export function ingestVerdicts(runId: number, records: FitRecord[]): Run | null {
  const run = db.select().from(fitRuns).where(eq(fitRuns.id, runId)).get();
  if (!run) return null;
  const criteria = listCriteria();
  const byKey = new Map(criteria.map((c) => [c.key, c]));

  db.delete(fitVerdicts).where(eq(fitVerdicts.runId, runId)).run();
  const requirements: Record<string, string> = {};
  for (const rec of records) {
    const c = byKey.get(rec.criterionKey);
    if (!c) continue; // unknown criterion key → skip
    requirements[rec.criterionKey] = rec.requirement ?? "";
    db.insert(fitVerdicts).values({
      runId, criterionKey: rec.criterionKey, requirement: rec.requirement ?? null,
      type: c.type, verdict: normalizeVerdict(rec.verdict), confidence: clampConf(rec.confidence),
      evidence: rec.evidence ?? null, reasoning: rec.reasoning ?? null, humanVerdict: null, humanNote: null, labeledAt: null,
    }).run();
  }

  const detectArtifact = db.select().from(fitVerdicts).where(eq(fitVerdicts.runId, runId)).all()
    .map((v) => ({ criterionKey: v.criterionKey, verdict: v.verdict, confidence: v.confidence, evidence: v.evidence }));
  const stages: StageTrace[] = [
    { stage: "extract", ms: 0, artifact: requirements },
    { stage: "detect", ms: 0, artifact: detectArtifact },
  ];
  db.update(fitRuns).set({ stages: JSON.stringify(stages) }).where(eq(fitRuns.id, runId)).run();
  recomputeDecision(runId, criteria.filter((c) => c.active), stages);
  return assembleRun(runId);
}

const clampConf = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 40;
};

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
