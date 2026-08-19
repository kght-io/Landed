// THE DRAIN LOOP.
//
// This is the capability that justifies shipping a desktop app at all. A connector inside someone
// else's client can notice queued work, but it cannot start a model turn on its own — every turn is
// anchored to a person sitting in a session. Only a process the user installed can run a tailoring
// job at 3am. Everything else this app does could live somewhere cheaper; this could not.
//
// The loop is deliberately thin, because the queue already does the hard parts. `/api/jobs/wait`
// long-polls, so there is no interval to tune and no busy-wait. The agent claims and submits
// through its own MCP tools, so this never touches a job record. What is left is: notice work,
// start an agent, do not start a second one, and survive a crashing one.
//
// poll/run/delay are injected so those rules are testable without a network or an Electron app.

export type WaitResult = { ready: boolean; reason?: "work" | "trigger"; type: string; count: number };

export type DrainLoopOptions = {
  /** Job types to drain, each polled independently. */
  types: string[];
  /** Long-poll for claimable work. Resolves when work appears or the poll times out. */
  poll: (type: string, signal: AbortSignal) => Promise<WaitResult>;
  /** Run an agent until the type's queue is empty. Resolves when the run exits. */
  run: (type: string) => Promise<void>;
  /** Reported, never thrown — the loop's whole point is to outlive individual failures. */
  onError?: (error: unknown, type: string) => void;
  /** Pause after a failure. Injected so tests do not wait. */
  delay?: (ms: number) => Promise<void>;
};

export type DrainStatus = { running: string[]; stopped: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Backoff after a failure. Capped low: the common causes (logged out, CLI missing, app restarting)
// are fixed by a human within seconds, and a long backoff makes the app feel broken after the fix.
const backoffMs = (failures: number) => Math.min(1000 * 2 ** Math.min(failures, 5), 30_000);

export function createDrainLoop(opts: DrainLoopOptions) {
  const { types, poll, run, onError, delay = sleep } = opts;
  const running = new Set<string>();
  const controller = new AbortController();
  let stopped = false;

  /**
   * One type's loop. Runs forever: poll, run if there is work, poll again.
   *
   * Sequential per type by construction — the next poll only happens after the current run resolves
   * — so two agents can never drain the same queue at once and race on claims. Different types DO
   * run in parallel, which is the queue's own model (one process per type).
   */
  async function drain(type: string): Promise<void> {
    let failures = 0;
    while (!stopped) {
      try {
        const result = await poll(type, controller.signal);
        if (stopped) return;
        if (result.ready) {
          running.add(type);
          try {
            await run(type);
          } finally {
            running.delete(type);
          }
        }
        failures = 0;
      } catch (e) {
        if (stopped) return;
        running.delete(type);
        onError?.(e, type);
        failures++;
        await delay(backoffMs(failures));
      }
    }
  }

  return {
    /** Resolves once every type's loop has stopped. */
    start: (): Promise<void> => Promise.all(types.map(drain)).then(() => undefined),
    stop: (): void => {
      stopped = true;
      controller.abort(); // hangs up any in-flight long-poll rather than waiting it out
    },
    status: (): DrainStatus => ({ running: [...running], stopped }),
  };
}
