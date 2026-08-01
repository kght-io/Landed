// The jobs surface — a re-export barrel, kept so the ~25 route handlers and tests that import
// `@landed/backend/jobs/store` don't have to care where a given function lives.
//
// The code moved out along its real seam:
//
//   ./queue.ts            the TYPE-AGNOSTIC spine — create, list, claim (lease), reap, ingest.
//                         Knows nothing about fit/tailoring/inbox; per-type side effects are
//                         declared as hooks on JobDef (afterIngest / onUnqueue / redoPhase).
//   ./registry.ts         the per-type definitions themselves (playbook, buildTask, ingest, hooks).
//   ./enqueue/<domain>.ts WHEN a job of that kind gets queued, and what it carries.
//   ./context.ts          the read-context snapshot the agent works against.
//
// New code should import from the specific module; this barrel exists for the existing callers.

export * from "./queue";
export * from "./context";
export * from "./enqueue/inbox";
export * from "./enqueue/watchlist";
export * from "./enqueue/fit";
export * from "./enqueue/tailoring";
export * from "./enqueue/prep";
