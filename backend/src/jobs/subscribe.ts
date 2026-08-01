import { onStageChange } from "../db/stage-change";
import { maybeQueuePrepResearch } from "./enqueue/prep";

// ── where the jobs layer reacts to the rest of the app ──
// Side-effect module: importing it registers the subscriptions. ./store.ts imports it so any caller
// that touches the jobs barrel wires this up; nothing else needs to know it exists.
//
// This is the half of the inverted dependency that used to be an import edge the other way — `db`
// and `agents` calling into `jobs` directly (see ../db/stage-change.ts for why that was a problem).

// Reaching the interview stage earns a one-shot prep-research job for that company. The enqueue is
// idempotent on a deterministic per-company id, so a duplicate emit costs nothing.
onStageChange("prep-research", ({ companyId, from, to }) => {
  maybeQueuePrepResearch(companyId, from, to);
});
