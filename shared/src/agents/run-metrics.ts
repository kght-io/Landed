// What one agent run cost and whether it worked.
//
// The Claude Code CLI writes a final `result` frame to every run journal carrying everything the
// dashboard needs — turns, API duration, token usage split by kind, per-model usage, cost, and how
// the run ended. Nothing new has to be instrumented; it just has to be KEPT, because the journals
// are overwritten on each launch and hold exactly one run of history.
//
// Pure, so the parse can be tested against a real captured frame rather than by running an agent.

export type AgentRunMetrics = {
  sessionId: string; // the CLI's own id — the idempotency key when a run is ingested twice
  type: string; // agent type (fit, tailoring, …) — from the journal filename, not the frame
  endedAt: string; // ISO
  ok: boolean;
  terminalReason: string | null;
  numTurns: number | null;
  durationApiMs: number | null;
  costUsd: number | null;
  // Kept apart on purpose. On a real fit run: 94 input vs 4,139,631 cache-read. Summing them into
  // one "input" figure would swamp the number that actually moves between runs.
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  thinkingTokens: number | null;
  denials: number; // permission denials — the agent tried something and was blocked, silently
  models: string[]; // a run can span models (Haiku for subagents, Opus for the work)
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Only `completed` counts. A run the watchdog killed, or one that burned its turn limit, reports
// `is_error: false` — reading that alone would score a dead run as a clean one.
const SUCCESS_REASONS = new Set(["completed"]);

// One journal line → metrics, or null if it isn't a finished run.
//
// Deliberately lenient about EVERY field except the frame type: a killed run's frame can be missing
// all of them, and that run is precisely the one worth recording. A row with null metrics and
// ok:false is the observability; dropping it would hide the failures the dashboard exists to show.
export function parseRunResult(line: string, type = "", endedAt?: string): AgentRunMetrics | null {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null; // truncated or non-JSON — journals get cut off mid-write
  }
  if (!d || d.type !== "result") return null;

  const usage = (d.usage ?? {}) as Record<string, unknown>;
  const details = (usage.output_tokens_details ?? {}) as Record<string, unknown>;
  const reason = typeof d.terminal_reason === "string" ? d.terminal_reason : null;

  return {
    sessionId: typeof d.session_id === "string" ? d.session_id : "",
    type,
    endedAt: endedAt ?? new Date().toISOString(),
    ok: d.is_error !== true && reason !== null && SUCCESS_REASONS.has(reason),
    terminalReason: reason,
    numTurns: num(d.num_turns),
    durationApiMs: num(d.duration_api_ms),
    costUsd: num(d.total_cost_usd),
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    cacheCreationTokens: num(usage.cache_creation_input_tokens),
    thinkingTokens: num(details.thinking_tokens),
    denials: Array.isArray(d.permission_denials) ? d.permission_denials.length : 0,
    models: d.modelUsage && typeof d.modelUsage === "object" ? Object.keys(d.modelUsage as object) : [],
  };
}

// ── the trend ─────────────────────────────────────────────────────────────────────────────────
export type Period = "day" | "week" | "month";

export type RunBucket = {
  key: string; // the bucket's start — YYYY-MM-DD, or YYYY-MM for a month
  runs: number;
  failed: number;
  // Averages over SUCCESSFUL runs only. A failed run's duration measures how long it took to die,
  // not how long the work takes — folding it in makes a bad week look fast.
  avgDurationMs: number | null;
  avgOutputTokens: number | null;
  avgTurns: number | null;
  costUsd: number; // summed, not averaged — the question is "what did this period cost"
};

function keyFor(iso: string, period: Period): string {
  const d = new Date(iso);
  if (period === "month") return iso.slice(0, 7);
  if (period === "day") return iso.slice(0, 10);
  // Week → the Monday on or before this date, so buckets are stable regardless of when you look.
  const day = (d.getUTCDay() + 6) % 7; // Mon = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function bucketRuns(runs: AgentRunMetrics[], period: Period): RunBucket[] {
  const by = new Map<string, AgentRunMetrics[]>();
  for (const r of runs) {
    const k = keyFor(r.endedAt, period);
    const list = by.get(k);
    if (list) list.push(r);
    else by.set(k, [r]);
  }

  return [...by.entries()]
    .map(([key, rs]) => {
      const good = rs.filter((r) => r.ok);
      const pick = (f: (r: AgentRunMetrics) => number | null) =>
        mean(good.map(f).filter((v): v is number => v !== null));
      return {
        key,
        runs: rs.length,
        failed: rs.filter((r) => !r.ok).length,
        avgDurationMs: pick((r) => r.durationApiMs),
        avgOutputTokens: pick((r) => r.outputTokens),
        avgTurns: pick((r) => r.numTurns),
        // Cost counts even for a failed run — a run that died after 40 turns still spent them.
        costUsd: rs.reduce((n, r) => n + (r.costUsd ?? 0), 0),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
