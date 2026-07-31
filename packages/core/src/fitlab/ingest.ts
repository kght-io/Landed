import { ingestVerdicts } from "./store";
import { normalizeVerdict, type FitRecord } from "@landed/shared/fitlab/task";
import type { ResultRecord } from "@landed/shared/jobs/types";
import type { ReconcileResult } from "@landed/shared/agents/types";
import { num, str } from "@landed/shared/coerce";

// Ingest a `fitlab-assess` result: the agent submits one record per criterion (carrying the runId it was
// given). We fill the pending run's verdicts + derive the decision. Imports nothing from lib/jobs/store,
// so the registry can import this without an import cycle. Mirrors the FitRecord contract in task.ts.
export function ingestFitLabResult(records: ResultRecord[], dryRun?: boolean): ReconcileResult {
  const parsed: FitRecord[] = records
    .map((r) => ({
      runId: num(r.runId) ?? 0,
      criterionKey: str(r.criterionKey) ?? "",
      requirement: str(r.requirement) ?? "",
      verdict: normalizeVerdict(r.verdict),
      confidence: num(r.confidence) ?? 40,
      evidence: str(r.evidence) ?? null,
      reasoning: str(r.reasoning) ?? null,
    }))
    .filter((r) => r.runId && r.criterionKey);

  const runId = parsed[0]?.runId;
  if (!runId) {
    return { inserted: 0, updated: 0, fieldChanges: 0, flagged: 0, pending: 0, newCompanies: 0, summary: "no valid fit verdicts", details: [] };
  }

  if (dryRun) {
    return { inserted: 0, updated: parsed.length, fieldChanges: parsed.length, flagged: 0, pending: 0, newCompanies: 0, summary: `${parsed.length} verdicts (preview)`, details: parsed.map((p) => ({ action: "update", summary: `${p.criterionKey} → ${p.verdict}` })) };
  }

  const run = ingestVerdicts(runId, parsed);
  const label = run ? `${run.company} — ${run.role}` : `run ${runId}`;
  const summary = run ? `${label} · ${parsed.length} verdicts · ${run.score ?? "?"} (${run.decision ?? "?"})` : `run ${runId} not found`;
  return { inserted: 0, updated: parsed.length, fieldChanges: parsed.length, flagged: run ? 0 : 1, pending: 0, newCompanies: 0, summary, details: [{ action: run ? "update" : "flag", summary }] };
}
