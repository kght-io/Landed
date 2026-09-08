import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { reset } from "./helpers";
import { ingestRun, ingestAllRuns, agentDashboard, agentTypesWithRuns } from "@landed/backend/db/agent-metrics";
import { runDir, ensureRunDir, runPaths } from "@landed/backend/agents/run-log";

beforeEach(() => {
  reset();
  ensureRunDir();
  for (const f of fs.readdirSync(runDir())) fs.rmSync(path.join(runDir(), f), { force: true });
});

const frame = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "result", is_error: false, terminal_reason: "completed",
    session_id: "sess-1", num_turns: 12, duration_api_ms: 120_000, total_cost_usd: 0.5,
    usage: { input_tokens: 50, output_tokens: 900, cache_read_input_tokens: 1_000_000 },
    modelUsage: { "claude-opus-5": {} },
    ...over,
  });

// A journal is stream-json: many frames, the result last. Writing one the way the CLI does.
function writeJournal(type: string, lines: string[]) {
  fs.writeFileSync(runPaths(type).log, lines.join("\n") + "\n");
}

test("a finished run is lifted out of the journal into the table", () => {
  writeJournal("fit", [JSON.stringify({ type: "assistant", message: {} }), frame()]);
  assert.equal(ingestRun("fit"), true);

  const d = agentDashboard("fit");
  assert.equal(d.runs.length, 1);
  assert.equal(d.runs[0].numTurns, 12);
  assert.equal(d.runs[0].ok, true);
});

// The whole point of keying on session_id: the tailer records a run the moment it ends, and the
// dashboard sweeps again later. Both must be able to fire without double-counting.
test("ingesting the same journal twice records one run", () => {
  writeJournal("fit", [frame()]);
  assert.equal(ingestRun("fit"), true);
  assert.equal(ingestRun("fit"), false, "second call is a no-op");
  assert.equal(agentDashboard("fit").runs.length, 1);
});

// This is the failure the table exists to prevent. The journal is truncated on the next launch, so
// once run 2 overwrites run 1, run 1 survives ONLY because it was already ingested.
test("history survives the journal being overwritten by the next run", () => {
  writeJournal("fit", [frame({ session_id: "run-1" })]);
  ingestRun("fit");

  writeJournal("fit", [frame({ session_id: "run-2" })]); // the CLI truncates on relaunch
  ingestRun("fit");

  const ids = agentDashboard("fit").runs.map((r) => r.sessionId).sort();
  assert.deepEqual(ids, ["run-1", "run-2"], "both runs are kept, though only one is on disk");
});

// A run that finished with no browser attached is exactly the overnight case — the sweep is what
// catches it, so it has to work without anyone having tailed the run.
test("the sweep picks up every type's journal", () => {
  writeJournal("fit", [frame({ session_id: "f1" })]);
  writeJournal("tailoring", [frame({ session_id: "t1" })]);

  assert.equal(ingestAllRuns(), 2);
  assert.deepEqual(agentTypesWithRuns(), ["fit", "tailoring"]);
});

test("a journal with no result frame yields no run", () => {
  writeJournal("fit", [JSON.stringify({ type: "assistant", message: {} })]);
  assert.equal(ingestRun("fit"), false);
  assert.equal(agentDashboard("fit").runs.length, 0);
});

test("a missing journal is not an error", () => {
  assert.equal(ingestRun("never-ran"), false);
  assert.equal(agentDashboard("never-ran").runs.length, 0);
});

// A killed run leaves the result frame followed by whatever was mid-write. Scanning backwards for
// the last PARSEABLE result is what makes that recoverable.
test("trailing junk after the result frame doesn't hide the run", () => {
  writeJournal("fit", [frame(), '{"type":"assistant","mess']);
  assert.equal(ingestRun("fit"), true);
  assert.equal(agentDashboard("fit").runs.length, 1);
});

// The observability requirement: a failed run must show up, not be filtered out for lacking metrics.
test("a failed run is recorded, not skipped", () => {
  writeJournal("fit", [frame({ is_error: true, terminal_reason: "error", session_id: "bad" })]);
  ingestRun("fit");

  const d = agentDashboard("fit");
  assert.equal(d.runs.length, 1);
  assert.equal(d.runs[0].ok, false);
  assert.equal(d.totals.failed, 1);
});

test("the dashboard separates types", () => {
  writeJournal("fit", [frame({ session_id: "f1" })]);
  writeJournal("tailoring", [frame({ session_id: "t1" })]);
  ingestAllRuns();

  assert.equal(agentDashboard("fit").runs.length, 1);
  assert.equal(agentDashboard("tailoring").runs.length, 1);
});

test("totals sum cost across the window", () => {
  writeJournal("fit", [frame({ session_id: "a", total_cost_usd: 1.5 })]);
  ingestRun("fit");
  writeJournal("fit", [frame({ session_id: "b", total_cost_usd: 2.25 })]);
  ingestRun("fit");

  assert.equal(agentDashboard("fit").totals.costUsd, 3.75);
});
