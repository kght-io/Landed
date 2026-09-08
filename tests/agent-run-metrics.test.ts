import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRunResult, bucketRuns, type AgentRunMetrics } from "@landed/shared/agents/run-metrics";
import { realRepoPath } from "./helpers";

const fixture = readFileSync(realRepoPath("tests", "fixtures", "agent-run-result.json"), "utf8");

// ── parsing ───────────────────────────────────────────────────────────────────────────────────
// The `result` frame is the last line the CLI writes. Everything the dashboard shows comes from it,
// so this is the one parse that has to be right — the fixture is a REAL frame off a fit run.
test("a real result frame parses into metrics", () => {
  const m = parseRunResult(fixture)!;
  assert.ok(m, "the frame parses");
  assert.equal(m.sessionId, "261b861d-52d8-4dfd-9345-99b5dc3e0afb");
  assert.equal(m.ok, true);
  assert.equal(m.terminalReason, "completed");
  assert.equal(m.numTurns, 52);
  assert.equal(m.durationApiMs, 894382);
  assert.equal(m.costUsd, 5.2421865);
  assert.equal(m.outputTokens, 71818);
  assert.equal(m.thinkingTokens, 13135);
  assert.equal(m.cacheReadTokens, 4139631);
});

// Cache reads dwarf real input — 4.1M vs 94 on this run. Summing them into one "input" number would
// make every run look enormous and hide the number that actually varies.
test("input and cache tokens stay separate", () => {
  const m = parseRunResult(fixture)!;
  assert.equal(m.inputTokens, 94);
  assert.ok((m.cacheReadTokens ?? 0) > (m.inputTokens ?? 0) * 1000, "cache dwarfs input — they can't be one field");
});

test("per-model usage is kept", () => {
  const m = parseRunResult(fixture)!;
  assert.ok(m.models.includes("claude-opus-5"));
  assert.ok(m.models.length > 1, "a run can span models — that's worth seeing");
});

// ── failure detection — the observability the dashboard exists for ────────────────────────────
test("is_error marks a run failed", () => {
  const m = parseRunResult(JSON.stringify({ type: "result", is_error: true, session_id: "s1", terminal_reason: "error" }))!;
  assert.equal(m.ok, false);
});

// A run the watchdog killed, or one that hit its turn limit, did NOT succeed — even though
// `is_error` is false. Reading only `is_error` would score these as clean runs.
test("a non-completed terminal reason is a failure even when is_error is false", () => {
  for (const reason of ["killed", "max_turns", "timeout", "interrupted"]) {
    const m = parseRunResult(JSON.stringify({ type: "result", is_error: false, session_id: "s", terminal_reason: reason }))!;
    assert.equal(m.ok, false, `${reason} is not a success`);
  }
});

test("permission denials are counted — a silent failure mode", () => {
  const m = parseRunResult(JSON.stringify({
    type: "result", is_error: false, terminal_reason: "completed", session_id: "s",
    permission_denials: [{ tool_name: "Bash" }, { tool_name: "Write" }],
  }))!;
  assert.equal(m.denials, 2);
});

// ── robustness — journals are truncated, killed, and half-written ─────────────────────────────
test("a non-result frame is not a run", () => {
  assert.equal(parseRunResult(JSON.stringify({ type: "assistant", message: {} })), null);
});

test("a truncated or non-JSON line is not a run", () => {
  assert.equal(parseRunResult('{"type":"result","usa'), null);
  assert.equal(parseRunResult(""), null);
  assert.equal(parseRunResult("not json at all"), null);
});

// A killed run's frame can be missing everything but the type. It still has to produce a row —
// that IS the observability: a run with no metrics is exactly the one worth seeing.
test("a result frame with nothing but its type still yields a failed run", () => {
  const m = parseRunResult(JSON.stringify({ type: "result" }))!;
  assert.ok(m, "still a run");
  assert.equal(m.ok, false, "no terminal_reason means it didn't report success");
  assert.equal(m.numTurns, null);
  assert.equal(m.costUsd, null);
});

// ── bucketing for the trend ───────────────────────────────────────────────────────────────────
const run = (at: string, over: Partial<AgentRunMetrics> = {}): AgentRunMetrics => ({
  sessionId: at, type: "fit", endedAt: at, ok: true, terminalReason: "completed",
  numTurns: 10, durationApiMs: 60_000, costUsd: 1, inputTokens: 100, outputTokens: 200,
  cacheReadTokens: 0, cacheCreationTokens: 0, thinkingTokens: 0, denials: 0, models: [], ...over,
});

test("runs bucket by day", () => {
  const bs = bucketRuns([
    run("2026-08-26T01:00:00Z"),
    run("2026-08-26T23:00:00Z"),
    run("2026-08-25T05:00:00Z"),
  ], "day");
  assert.equal(bs.length, 2);
  assert.equal(bs[0].key, "2026-08-25");
  assert.equal(bs[1].runs, 2, "both of the 26th land together");
});

test("a bucket separates failures from successes", () => {
  const bs = bucketRuns([
    run("2026-08-26T01:00:00Z"),
    run("2026-08-26T02:00:00Z", { ok: false, terminalReason: "killed" }),
  ], "day");
  assert.equal(bs[0].runs, 2);
  assert.equal(bs[0].failed, 1);
});

// A failed run's duration is not a measurement of how long the work takes — it's how long it took to
// die. Averaging it into the trend makes a bad week look fast.
test("the duration average covers successful runs only", () => {
  const bs = bucketRuns([
    run("2026-08-26T01:00:00Z", { durationApiMs: 100_000 }),
    run("2026-08-26T02:00:00Z", { ok: false, durationApiMs: 1_000 }),
  ], "day");
  assert.equal(bs[0].avgDurationMs, 100_000);
});

test("a bucket with no successful run reports no average rather than zero", () => {
  const bs = bucketRuns([run("2026-08-26T01:00:00Z", { ok: false })], "day");
  assert.equal(bs[0].avgDurationMs, null);
  assert.equal(bs[0].failed, 1);
});

test("week and month bucket to their period start", () => {
  const wk = bucketRuns([run("2026-08-26T00:00:00Z")], "week");
  assert.match(wk[0].key, /^\d{4}-\d{2}-\d{2}$/);
  const mo = bucketRuns([run("2026-08-26T00:00:00Z")], "month");
  assert.equal(mo[0].key, "2026-08");
});

test("bucketing nothing yields nothing", () => {
  assert.deepEqual(bucketRuns([], "day"), []);
});
