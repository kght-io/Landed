import fs from "node:fs";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "./index";
import { agentRunMetrics } from "./schema";
import { runDir, runPaths } from "../agents/run-log";
import { parseRunResult, bucketRuns, type AgentRunMetrics, type Period, type RunBucket } from "@landed/shared/agents/run-metrics";

// Keeping agent run telemetry, which the journals themselves don't.
//
// `data/agent-runs/<type>.jsonl` holds ONE run per agent type and is truncated on the next launch.
// So "is tailoring getting slower" is unanswerable from the journals by construction — the previous
// run is already gone. This module lifts the CLI's final `result` frame into a table before that
// happens.
//
// Ingest is idempotent on the CLI's `session_id`, which is what makes it safe to call from two
// places: the live tailer the moment a run ends, and a sweep whenever the dashboard is read. Both
// are needed — the tailer only runs while a browser is attached, so an overnight queue drain would
// otherwise be recorded nowhere.

// The result frame is the LAST line of a journal, but a killed run can leave trailing junk. Scan
// backwards for the first line that parses as a result rather than assuming the final line is one.
function lastResultLine(file: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null; // no journal for this type yet
  }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l && parseRunResult(l)) return l;
  }
  return null;
}

function insert(m: AgentRunMetrics): boolean {
  if (!m.sessionId) return false; // no idempotency key → can't safely store it
  const before = db.select({ id: agentRunMetrics.sessionId }).from(agentRunMetrics).where(eq(agentRunMetrics.sessionId, m.sessionId)).get();
  if (before) return false;
  db.insert(agentRunMetrics).values({
    sessionId: m.sessionId,
    type: m.type,
    endedAt: m.endedAt,
    ok: m.ok,
    terminalReason: m.terminalReason,
    numTurns: m.numTurns,
    durationApiMs: m.durationApiMs,
    costUsd: m.costUsd,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheReadTokens: m.cacheReadTokens,
    cacheCreationTokens: m.cacheCreationTokens,
    thinkingTokens: m.thinkingTokens,
    denials: m.denials,
    models: m.models.length ? JSON.stringify(m.models) : null,
  }).onConflictDoNothing().run();
  return true;
}

// Record one type's finished run. Returns whether a new row landed (false = already had it, which is
// the normal case on a re-read).
export function ingestRun(type: string): boolean {
  const file = runPaths(type).log;
  const line = lastResultLine(file);
  if (!line) return false;
  // The journal's mtime is when the run finished — better than "now", which would misdate every run
  // the sweep picks up hours later.
  let endedAt = new Date().toISOString();
  try {
    endedAt = fs.statSync(file).mtime.toISOString();
  } catch {
    /* keep the fallback */
  }
  const m = parseRunResult(line, type, endedAt);
  return m ? insert(m) : false;
}

// Sweep every journal on disk. Cheap (one small read per agent type) and idempotent, so it can run
// on any dashboard read — that's what catches runs which finished with nobody watching.
export function ingestAllRuns(): number {
  let added = 0;
  let files: string[];
  try {
    files = fs.readdirSync(runDir());
  } catch {
    return 0; // no run dir yet — nothing has ever run
  }
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    if (ingestRun(f.replace(/\.jsonl$/, ""))) added++;
  }
  return added;
}

// ── reads ─────────────────────────────────────────────────────────────────────────────────────
const toMetrics = (r: typeof agentRunMetrics.$inferSelect): AgentRunMetrics => ({
  sessionId: r.sessionId,
  type: r.type,
  endedAt: r.endedAt,
  ok: r.ok,
  terminalReason: r.terminalReason,
  numTurns: r.numTurns,
  durationApiMs: r.durationApiMs,
  costUsd: r.costUsd,
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
  cacheReadTokens: r.cacheReadTokens,
  cacheCreationTokens: r.cacheCreationTokens,
  thinkingTokens: r.thinkingTokens,
  denials: r.denials,
  models: (() => {
    try {
      const v = JSON.parse(r.models ?? "[]");
      return Array.isArray(v) ? (v as string[]) : [];
    } catch {
      return [];
    }
  })(),
});

export type AgentDashboard = {
  type: string;
  period: Period;
  runs: AgentRunMetrics[]; // newest first — the per-run success/failure list
  trend: RunBucket[]; // oldest first — the graph
  totals: { runs: number; failed: number; costUsd: number };
};

// One agent's dashboard. `sinceDays` bounds the window; the period only controls bucketing, so a
// month view over 7 days of data is one bucket rather than an error.
export function agentDashboard(type: string, period: Period = "day", sinceDays = 30): AgentDashboard {
  ingestAllRuns(); // catch anything that finished while nobody was watching
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const rows = db
    .select()
    .from(agentRunMetrics)
    .where(and(eq(agentRunMetrics.type, type), gte(agentRunMetrics.endedAt, since)))
    .orderBy(desc(agentRunMetrics.endedAt))
    .all()
    .map(toMetrics);

  return {
    type,
    period,
    runs: rows,
    trend: bucketRuns(rows, period),
    totals: {
      runs: rows.length,
      failed: rows.filter((r) => !r.ok).length,
      costUsd: rows.reduce((n, r) => n + (r.costUsd ?? 0), 0),
    },
  };
}

// Several agents at once, for the comparison charts. One sweep and one query per type, but the
// caller gets a single payload — the dashboard overlays these as series on a shared axis.
export function agentDashboards(types: string[], period: Period = "day", sinceDays = 30): AgentDashboard[] {
  return types.map((t) => agentDashboard(t, period, sinceDays));
}

// Which agent types have telemetry — drives the dashboard's type switcher.
export function agentTypesWithRuns(): string[] {
  ingestAllRuns();
  return [...new Set(db.select({ type: agentRunMetrics.type }).from(agentRunMetrics).all().map((r) => r.type))].sort();
}
