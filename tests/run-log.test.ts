import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runPaths, runDir, splitFrames, isTerminalLine, isAlive } from "@landed/backend/agents/run-log";

// Journal paths must stay inside data/agent-runs and sanitise the type so it can't escape the dir.
test("runPaths keeps files inside the run dir and sanitises the type", () => {
  const dir = runDir();
  const p = runPaths("fit");
  assert.equal(path.dirname(p.log), dir);
  assert.ok(p.log.endsWith(path.join("agent-runs", "fit.jsonl")));

  const evil = runPaths("../../etc/passwd");
  assert.equal(path.dirname(evil.log), dir, "a traversal-y type can't escape the run dir");
  assert.ok(!evil.log.includes(".."), "dots are sanitised out of the filename");
});

// The tailer splits only COMPLETE lines and holds back a half-written trailing frame.
test("splitFrames returns complete lines and keeps the trailing partial", () => {
  const { lines, rest } = splitFrames('{"a":1}\n{"b":2}\n{"c":');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  assert.equal(rest, '{"c":', "the incomplete frame is retained for the next read");
});

test("splitFrames drops blank lines", () => {
  const { lines } = splitFrames("\n\n{\"x\":1}\n\n");
  assert.deepEqual(lines, ['{"x":1}']);
});

// Only claude's `result` line ends a run; assistant/tool lines and noise do not.
test("isTerminalLine detects the result frame and nothing else", () => {
  assert.equal(isTerminalLine('{"type":"result","is_error":false}'), true);
  assert.equal(isTerminalLine('{"type":"assistant"}'), false);
  assert.equal(isTerminalLine("not json at all"), false);
});

// isAlive probes a real pid without signalling it.
test("isAlive is true for this process and false for bogus pids", () => {
  assert.equal(isAlive(process.pid), true);
  assert.equal(isAlive(2_000_000_000), false, "a pid that can't exist is not alive");
  assert.equal(isAlive(-1), false);
  assert.equal(isAlive(0), false);
});
