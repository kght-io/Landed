import { onStageChange } from "../db/stage-change";
import { maybeQueueInterviewBrief } from "./enqueue/prep";

// ── where the jobs layer reacts to the rest of the app ──
// Side-effect module: importing it registers the subscriptions. ./store.ts imports it so any caller
// that touches the jobs barrel wires this up; nothing else needs to know it exists.
//
// This is the half of the inverted dependency that would otherwise be an import edge the other way —
// `db` and `agents` calling into `jobs` directly (see ../db/stage-change.ts for why that was a
// problem).

// Reaching the interview stage earns an interview brief for that posting. The enqueue is idempotent
// per posting and skips a brief that already exists, so a duplicate emit costs nothing.
onStageChange("interview-brief", ({ postingId, from, to }) => {
  maybeQueueInterviewBrief(postingId, from, to);
});
