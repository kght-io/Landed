import { queuedCountForType, takeDrainTrigger } from "./queue";
import { sweepQueue } from "./sweep";

// ── the app → agent wake signal ──
// A pinned agent chat loops on the `waitForWork` MCP tool, which blocks until there is claimable
// work of its type OR the user clicks "Drain" (a one-shot trigger). This is what lets the app drive
// a waiting chat as a worker without you having to switch to the agent and prompt it.
//
// The loop lives here rather than in the route handler because it is queue semantics — how an agent
// waits for work — not HTTP. The route's job is to turn the result into a Response.

const TICK_MS = 1_000;
const DEFAULT_WAIT_MS = 25_000;
// Capped: long enough to be efficient, short enough to stay under MCP/client timeouts.
const MAX_WAIT_MS = 28_000;
const MIN_WAIT_MS = 1_000;
// Sweep every Nth tick rather than every one. `queuedCountForType` reads the LEASE-derived status,
// so without a sweep a job whose agent went silent stays invisible here until its 60-minute lease
// lapses — the ~15-minute heartbeat signal only fires inside the sweep. The heartbeat window is
// minutes, so a 5s cadence loses nothing and saves re-running the reconcilers 28× per request.
const SWEEP_EVERY_TICKS = 5;

export type WaitResult = {
  ready: boolean;
  type: string;
  count: number;
  reason?: "work" | "trigger";
  aborted?: boolean;
};

export const clampWaitMs = (raw: unknown): number =>
  Math.min(Math.max(Number(raw) || DEFAULT_WAIT_MS, MIN_WAIT_MS), MAX_WAIT_MS);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Block until there's claimable work of `type`, the drain trigger fires, or `waitMs` elapses.
// Returns `{ ready: false }` on timeout so the caller loops and asks again — that keeps a pinned
// chat alive as an app-driven worker without hitting a transport timeout. `signal` lets a hung-up
// client stop the loop instead of polling on for a poll nobody is reading.
export async function waitForWork(
  type: string,
  // `waitMs` takes the raw query-param form too, so the route doesn't have to parse it.
  opts: { waitMs?: number | string | null; signal?: AbortSignal } = {},
): Promise<WaitResult> {
  const waitMs = clampWaitMs(opts.waitMs);
  const start = Date.now();
  for (let tick = 0; ; tick++) {
    if (tick % SWEEP_EVERY_TICKS === 0) sweepQueue();
    const count = queuedCountForType(type);
    if (count > 0) return { ready: true, reason: "work", type, count };
    if (takeDrainTrigger(type)) return { ready: true, reason: "trigger", type, count: 0 };
    if (Date.now() - start >= waitMs) return { ready: false, type, count: 0 };
    if (opts.signal?.aborted) return { ready: false, type, count: 0, aborted: true };
    await sleep(TICK_MS);
  }
}
