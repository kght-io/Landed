import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurnArgs } from "@landed/backend/agents/claude-code";

// The prompt goes over STDIN, never as an argv value.
//
// This is a real break, not a hypothetical: a message beginning with "- " (a markdown bullet — the
// most ordinary thing to paste into a chat) was handed to `claude -p <message>`, and the CLI read
// the leading dash as a flag:
//     claude -p "- say OK"   →  error: unknown option '- say OK'
// Every turn that started with a bullet, a hyphenated aside, or a pasted diff line failed.
test("the prompt is never passed as an argv value", () => {
  const { args, stdin } = chatTurnArgs({ message: "- https://example.com/x for tech depth", sid: "s1", resume: false });
  assert.equal(stdin, "- https://example.com/x for tech depth", "it goes over stdin");
  assert.ok(!args.includes("- https://example.com/x for tech depth"), "and never lands in argv");
});

// `-p` with no value is what tells the CLI to read the prompt from stdin.
test("-p is present but valueless", () => {
  const { args } = chatTurnArgs({ message: "hello", sid: "s1", resume: false });
  const i = args.indexOf("-p");
  assert.notEqual(i, -1, "-p is still how print-mode is requested");
  assert.notEqual(args[i + 1], "hello", "but it carries no prompt");
});

// The `--` escape was the other candidate fix and is WRONG here: it ends flag parsing, so every
// flag after it is swallowed as prompt text — a probe with `--` returned bare "OK" instead of JSON.
test("flags are not neutralised by a `--` separator", () => {
  const { args } = chatTurnArgs({ message: "- bullet", sid: "s1", resume: false });
  assert.equal(args.includes("--"), false);
  const i = args.indexOf("--output-format");
  assert.equal(args[i + 1], "json", "the output contract survives");
});

test("a new session mints an id; a resume continues one", () => {
  const fresh = chatTurnArgs({ message: "hi", sid: "abc", resume: false }).args;
  assert.equal(fresh[fresh.indexOf("--session-id") + 1], "abc");

  const cont = chatTurnArgs({ message: "hi", sid: "abc", resume: true }).args;
  assert.equal(cont[cont.indexOf("-r") + 1], "abc");
  assert.equal(cont.includes("--session-id"), false, "a resume doesn't also mint one");
});

// The scoping prompt seeds a NEW session only — a resume already carries it.
test("context is appended on a new session and omitted on a resume", () => {
  const withCtx = chatTurnArgs({ message: "hi", sid: "a", resume: false, context: "scope: Tubi" }).args;
  assert.equal(withCtx[withCtx.indexOf("--append-system-prompt") + 1], "scope: Tubi");

  const resumed = chatTurnArgs({ message: "hi", sid: "a", resume: true, context: "scope: Tubi" }).args;
  assert.equal(resumed.includes("--append-system-prompt"), false);
});

// A context that is itself dash-leading would reintroduce the same bug through the other door.
test("a dash-leading context is still passed safely", () => {
  const { args } = chatTurnArgs({ message: "hi", sid: "a", resume: false, context: "- scoped to Tubi" });
  assert.equal(args[args.indexOf("--append-system-prompt") + 1], "- scoped to Tubi",
    "it's a flag VALUE, which is fine — only a value the CLI reads positionally breaks");
});
