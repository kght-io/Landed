// The CLI's stream-json → what a human reads. Two consumers now depend on this (the web SSE route
// and the desktop app), and the reasoning below is not recoverable from the shapes — which is
// exactly why it lives in one place with tests rather than in two that drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contextOf,
  emptyTranscript,
  previewOf,
  reduceFrame,
  translate,
  type Frame,
  type TranslateState,
} from "@landed/shared/agents/stream";

const line = (o: unknown) => JSON.stringify(o);
let id = 0;
const nextId = () => ++id;
const fold = (frames: Frame[]) => frames.reduce((t, f) => reduceFrame(t, f, nextId, () => "T"), emptyTranscript());

test("context counts cache_creation — dropping it makes a full window look empty", () => {
  // cache_creation is usually the BULK of a cached run. Omitting it was the bug that made the
  // meter read a few thousand tokens on a session most of the way through its window.
  assert.equal(
    contextOf({ input_tokens: 1000, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 100_000 }),
    121_000,
  );
  assert.equal(contextOf(undefined), 0);
});

test("usage is emitted per turn, not only at the end", () => {
  // A run cut off before `result` — auto-stop, stall, API blip — must still have reported context.
  const state: TranslateState = {};
  const frames = translate(line({ type: "assistant", message: { usage: { input_tokens: 5 }, content: [] } }), state);
  assert.deepEqual(frames, [{ kind: "usage", contextTokens: 5 }]);
});

test("result reports the LAST turn's context, not the session's cumulative total", () => {
  // result.usage climbs with turn count and can reach millions; it never says how full the window is.
  const state: TranslateState = {};
  translate(line({ type: "assistant", message: { usage: { input_tokens: 900 }, content: [] } }), state);
  const [frame] = translate(
    line({ type: "result", result: "done", is_error: false, total_cost_usd: 0.42, num_turns: 7, usage: { input_tokens: 9_000_000 } }),
    state,
  );
  assert.deepEqual(frame, { kind: "result", text: "done", isError: false, costUsd: 0.42, turns: 7, contextTokens: 900 });
});

test("non-JSON noise is ignored rather than surfaced", () => {
  assert.deepEqual(translate("Downloading update...", {}), []);
  assert.deepEqual(translate("", {}), []);
});

test("tool calls and their results come through as separate frames", () => {
  const state: TranslateState = {};
  assert.deepEqual(translate(line({ type: "assistant", message: { content: [{ type: "tool_use", name: "claimNext", input: { type: "fit" } }] } }), state), [
    { kind: "tool", name: "claimNext", input: { type: "fit" } },
  ]);
  assert.deepEqual(translate(line({ type: "user", message: { content: [{ type: "tool_result", is_error: false, content: "ok" }] } }), state), [
    { kind: "tool_result", ok: true, preview: "ok" },
  ]);
});

test("a huge tool result is truncated, and whitespace collapsed", () => {
  const preview = previewOf("a".repeat(5000));
  assert.equal(preview.length, 2001); // 2000 + the ellipsis
  assert.equal(previewOf([{ text: "one\n\n  two" }]), "one two");
});

test("consecutive prose merges into ONE assistant entry", () => {
  // The CLI emits prose in chunks. One entry per chunk turns a paragraph into a column of fragments.
  const t = fold([{ kind: "text", text: "Claiming " }, { kind: "text", text: "a job." }]);
  assert.equal(t.entries.length, 1);
  assert.deepEqual(t.entries[0], { id: t.entries[0].id, role: "assistant", text: "Claiming a job.", at: "T" });
});

test("a tool result attaches to the most recent UNRESOLVED call, searching backwards", () => {
  // Parallel calls resolve out of order; pairing by arrival would put a result under the wrong call.
  const t = fold([
    { kind: "tool", name: "first", input: {} },
    { kind: "tool", name: "second", input: {} },
    { kind: "tool_result", ok: true, preview: "for second" },
    { kind: "tool_result", ok: false, preview: "for first" },
  ]);
  const tools = t.entries.filter((e) => e.role === "tool") as Extract<(typeof t.entries)[number], { role: "tool" }>[];
  assert.equal(tools[0].result?.preview, "for first");
  assert.equal(tools[1].result?.preview, "for second");
  assert.equal(tools[0].result?.ok, false);
});

test("an errored result becomes a visible note, not a silent field", () => {
  const t = fold([{ kind: "result", text: "playbook missing", isError: true, costUsd: 0.1 }]);
  assert.equal(t.entries.at(-1)?.role, "note");
  assert.equal(t.costUsd, 0.1);
});
