// Import CoWork's coding-prep progress artifact into prep_attempts / prep_progress.
//
// CoWork exports two paired files (see data/prep/):
//   coding-plan.json     — the curriculum: days → problems, each with a numeric `id` + LC `num`.
//   coding-progress.json — progress keyed by that plan `id`: { completed, times, noted, redo, exported }.
//
// The plan `id` is CoWork-local, so we map id → LC num → catalog question (fallback: name).
// Idempotent: a "completed" item only logs a solved attempt if the question has none yet,
// so re-importing a fresher export won't inflate times-done. Flags upsert. Never deletes.
//
//   npm run import:prep                 (defaults to data/prep/*.json)
//   npm run import:prep -- <plan> <progress>
import fs from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { db } from "@landed/core/db";
import { prepQuestions, prepAttempts, prepProgress } from "@landed/core/db/schema";
import { norm } from "@landed/shared/agents/canonical";

type PlanProblem = { id: number; name: string; num?: number; review?: boolean };
type Plan = { problems: PlanProblem[] }[];
type Progress = {
  completed?: Record<string, boolean>;
  times?: Record<string, string | number>;
  noted?: Record<string, boolean>;
  redo?: { id: number; addedAt?: number }[];
  exported?: string;
};

const dataDir = path.join(__dirname, "..", "data", "prep");
const planPath = process.argv[2] || path.join(dataDir, "coding-plan.json");
const progPath = process.argv[3] || path.join(dataDir, "coding-progress.json");

const plan: Plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const progress: Progress = JSON.parse(fs.readFileSync(progPath, "utf8"));

// plan id → { num, name }
const planById = new Map<number, PlanProblem>();
for (const day of plan) for (const p of day.problems) planById.set(p.id, p);

// catalog lookups
const catalog = db.select().from(prepQuestions).all();
const byNum = new Map<number, (typeof catalog)[number]>();
const byName = new Map<string, (typeof catalog)[number]>();
for (const q of catalog) {
  if (q.leetcodeNum != null) byNum.set(q.leetcodeNum, q);
  byName.set(norm(q.name), q);
}

function resolve(planId: number): { id: string; name: string } | null {
  const p = planById.get(planId);
  if (!p) return null;
  const hit = (p.num != null ? byNum.get(p.num) : undefined) ?? byName.get(norm(p.name));
  return hit ? { id: hit.id, name: hit.name } : null;
}

// "60+" → 3600s; "45" → 2700s; 12 → 720s. Returns { sec, raw } or null.
function parseTime(v: string | number | undefined): { sec: number; raw: string } | null {
  if (v == null) return null;
  const raw = String(v);
  const m = raw.match(/\d+/);
  if (!m) return null;
  return { sec: parseInt(m[0], 10) * 60, raw };
}

const when = progress.exported || new Date().toISOString();
const hasSolved = (qid: string) =>
  db.select().from(prepAttempts).where(and(eq(prepAttempts.questionId, qid), eq(prepAttempts.status, "solved"))).get() != null;

let solved = 0, skippedExisting = 0, redoSet = 0, notedSet = 0;
const unresolved: string[] = [];
const notDone: string[] = [];

// 1) completed → solved attempts
for (const [pid, done] of Object.entries(progress.completed ?? {})) {
  const planId = Number(pid);
  const q = resolve(planId);
  if (!q) { unresolved.push(`completed #${pid}`); continue; }
  if (!done) { notDone.push(q.name); continue; }
  if (hasSolved(q.id)) { skippedExisting++; continue; }
  const t = parseTime(progress.times?.[pid]);
  db.insert(prepAttempts).values({
    questionId: q.id,
    attemptedAt: when,
    durationSec: t?.sec ?? null,
    status: "solved",
    notes: t ? `imported (CoWork) · ${t.raw} min` : "imported (CoWork)",
  }).run();
  solved++;
  console.log(`  solved  ${q.name}${t ? ` · ${t.raw} min` : ""}`);
}

// 2) flags (redo / noted) — upsert prepProgress, preserving CoWork's addedAt
function setFlag(qid: string, patch: { redo?: boolean; noted?: boolean; redoAddedAt?: string | null }) {
  const existing = db.select().from(prepProgress).where(eq(prepProgress.questionId, qid)).get();
  const row = {
    questionId: qid,
    noted: patch.noted ?? existing?.noted ?? false,
    redo: patch.redo ?? existing?.redo ?? false,
    redoAddedAt: patch.redoAddedAt !== undefined ? patch.redoAddedAt : existing?.redoAddedAt ?? null,
    updatedAt: new Date().toISOString(),
  };
  if (existing) db.update(prepProgress).set(row).where(eq(prepProgress.questionId, qid)).run();
  else db.insert(prepProgress).values(row).run();
}

for (const r of progress.redo ?? []) {
  const q = resolve(r.id);
  if (!q) { unresolved.push(`redo #${r.id}`); continue; }
  setFlag(q.id, { redo: true, redoAddedAt: r.addedAt ? new Date(r.addedAt).toISOString() : null });
  redoSet++;
  console.log(`  redo    ${q.name}`);
}

for (const [pid, on] of Object.entries(progress.noted ?? {})) {
  if (!on) continue;
  const q = resolve(Number(pid));
  if (!q) { unresolved.push(`noted #${pid}`); continue; }
  setFlag(q.id, { noted: true });
  notedSet++;
  console.log(`  noted   ${q.name}`);
}

console.log(
  `\nprep progress imported — ${solved} solved logged, ${skippedExisting} already had a solve, ` +
    `${redoSet} redo, ${notedSet} noted.`
);
if (notDone.length) console.log(`not-yet-done (completed:false), left untouched: ${notDone.join(", ")}`);
if (unresolved.length) console.log(`UNRESOLVED (no catalog match): ${unresolved.join(", ")}`);
