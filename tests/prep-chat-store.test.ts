// The prep chat's conversation lives OUTSIDE React, because the component it renders in does not
// survive the user. Switching the drawer's tabs unmounts it; so does closing the drawer, or
// navigating from the pane to the chat's own page. A turn that only exists in component state dies
// with the component: the reply is dropped AND the session id is never persisted, so the next
// message opens a fresh Claude session with none of the conversation in it.
import "./setup";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { chatState, sendTurn, resetChat, __setChatDeps, type TurnResponse } from "@landed/shared/prep/chat-store";

// A localStorage stand-in + a controllable /api/agents/chat.
let store: Record<string, string>;
let resolveTurn: (body: TurnResponse) => void;
beforeEach(() => {
  store = {};
  __setChatDeps({
    storage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    },
    post: () => new Promise((res) => { resolveTurn = res; }),
  });
  resetChat("acme");
});

const stored = (suffix: string) => (store[`landed.prepchat.acme.${suffix}`] ?? null);

test("the user's message is persisted the moment it is sent, not when the reply lands", async () => {
  const turn = sendTurn("acme", { message: "hello", context: "ctx", slug: "acme" });
  assert.deepEqual(JSON.parse(stored("msgs")!).map((m: { text: string }) => m.text), ["hello"]);
  assert.equal(chatState("acme").busy, true);

  resolveTurn({ sessionId: "sess-1", reply: "hi" });
  await turn;
});

test("a turn completes into storage with NOBODY subscribed — the unmount case", async () => {
  const turn = sendTurn("acme", { message: "hello", context: "ctx", slug: "acme" });
  resolveTurn({ sessionId: "sess-1", reply: "hi there" });
  await turn;

  const msgs = JSON.parse(stored("msgs")!);
  assert.deepEqual(msgs.map((m: { role: string; text: string }) => [m.role, m.text]), [["user", "hello"], ["assistant", "hi there"]]);
  assert.equal(stored("sid"), "sess-1", "the session id survives, so the next message resumes it");
  assert.equal(chatState("acme").busy, false);
});

test("a remount reads the finished turn back — including one that finished while unmounted", async () => {
  const turn = sendTurn("acme", { message: "hello", context: "ctx", slug: "acme" });
  resolveTurn({ sessionId: "sess-1", reply: "hi there" });
  await turn;

  // A fresh mount is a fresh read of the same store.
  const seen = chatState("acme");
  assert.equal(seen.msgs.length, 2);
  assert.equal(seen.sid, "sess-1");
});

test("a failed turn leaves the conversation intact and says so", async () => {
  const turn = sendTurn("acme", { message: "hello", context: "ctx", slug: "acme" });
  resolveTurn({ error: "Claude Code run failed" });
  await turn;

  const msgs = JSON.parse(stored("msgs")!);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].error, true);
  assert.match(msgs[1].text, /failed/);
});

test("resetChat clears both keys — a cleared chat must not resume its old session", () => {
  sendTurn("acme", { message: "hello", context: "ctx", slug: "acme" });
  resetChat("acme");
  assert.equal(stored("msgs"), null);
  assert.equal(stored("sid"), null);
  assert.deepEqual(chatState("acme").msgs, []);
});
