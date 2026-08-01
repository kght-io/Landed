// Next.js calls `register` exactly once per server instance, before the first request is handled.
// This is where the app's startup wiring goes.
//
// What it wires: the jobs layer subscribes to db-level events (a posting changing stage earns a
// prep-research job) instead of the DB reaching up into the queue — see backend/src/db/stage-change.ts
// for why that inversion exists. Subscriptions register as an import side effect, so SOMETHING has to
// load them. The jobs barrel does it too, which covers every route that already touches the queue —
// but relying on that means a future route that only calls `updateApplication` would silently stop
// queueing prep research. Registering here makes it unconditional and independent of import order.
//
// Guarded on NEXT_RUNTIME: register runs in every runtime, and the backend opens better-sqlite3,
// which only exists on Node.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@landed/backend/jobs/subscribe");
  }
}
