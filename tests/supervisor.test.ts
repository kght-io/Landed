// The drain loop — the reason this app exists as a desktop app at all.
//
// A Claude connector can notice queued work but cannot start a model turn on its own; every turn is
// anchored to a user sitting in a session. Only a process the user installed can run a job while
// they are asleep. That is this loop, and it is the one capability that does not survive being
// re-homed into someone else's client.
//
// Poll and spawn are injected, so the loop's rules are testable without a network or an Electron
// app: long-poll a type, spawn an agent when work appears, never spawn twice for the same type, and
// survive a crashing agent rather than dying with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDrainLoop, type WaitResult } from "../desktop/src/supervisor";

const ready = (type: string): WaitResult => ({ ready: true, reason: "work", type, count: 1 });
const idle = (type: string): WaitResult => ({ ready: false, type, count: 0 });
const tick = () => new Promise((r) => setImmediate(r));

/** Runs the loop until `stop` resolves, with no real timers. */
function harness(script: WaitResult[], run: (type: string) => Promise<void>) {
  const polls: string[] = [];
  let i = 0;
  const loop = createDrainLoop({
    types: ["tailoring"],
    poll: async (type) => {
      polls.push(type);
      const next = script[i++];
      if (!next) {
        loop.stop();
        return idle(type);
      }
      return next;
    },
    run,
    delay: async () => {}, // no waiting in tests
  });
  return { loop, polls };
}

test("work found → agent spawned; then it goes back to polling", async () => {
  const ran: string[] = [];
  const { loop, polls } = harness([ready("tailoring"), idle("tailoring")], async (t) => {
    ran.push(t);
  });
  await loop.start();
  assert.deepEqual(ran, ["tailoring"]);
  assert.ok(polls.length >= 2, "kept polling after the run finished");
});

test("an idle poll spawns nothing — the long-poll already did the waiting", async () => {
  const ran: string[] = [];
  const { loop } = harness([idle("tailoring"), idle("tailoring")], async (t) => {
    ran.push(t);
  });
  await loop.start();
  assert.deepEqual(ran, []);
});

test("a crashing agent does not kill the loop", async () => {
  // An agent run fails for ordinary reasons — the CLI is missing, the user is logged out, a
  // playbook is wrong. If that ends the supervisor, the app looks alive and silently drains
  // nothing, which is the worst of both states.
  const seen: string[] = [];
  const errors: string[] = [];
  let first = true;
  const loop = createDrainLoop({
    types: ["tailoring"],
    poll: async (type) => {
      seen.push("poll");
      if (seen.length > 4) loop.stop();
      return ready(type);
    },
    run: async () => {
      if (first) {
        first = false;
        throw new Error("claude: command not found");
      }
      seen.push("ran");
    },
    onError: (e) => errors.push(String(e)),
    delay: async () => {},
  });
  await loop.start();
  assert.match(errors[0] ?? "", /command not found/);
  assert.ok(seen.includes("ran"), "recovered and ran on a later pass");
});

test("status reports what is running, so the tray can stop lying", async () => {
  let release: () => void = () => {};
  const started = new Promise<void>((r) => (release = r));
  const loop = createDrainLoop({
    types: ["tailoring"],
    poll: async (type) => ready(type),
    run: async () => {
      release();
      await new Promise(() => {}); // never finishes; we inspect mid-run
    },
    delay: async () => {},
  });
  void loop.start();
  await started;
  await tick();
  assert.deepEqual(loop.status().running, ["tailoring"]);
  loop.stop();
});

test("stop() ends the loop and reports it", async () => {
  const loop = createDrainLoop({
    types: ["tailoring"],
    poll: async (type) => idle(type),
    run: async () => {},
    delay: async () => {},
  });
  const done = loop.start();
  loop.stop();
  await done;
  assert.equal(loop.status().stopped, true);
});
