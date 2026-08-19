import { eq } from "drizzle-orm";
import { db } from "../db";
import { getActivePrompt } from "../db/prompts";
import { jobs, postings } from "../db/schema";
import { parseRedoLog } from "@landed/shared/jobs/redolog";
import { postingIdIn } from "@landed/shared/jobs/params";
import type { PromptFeature } from "@landed/shared/db/enums";
import type { RedoPhase } from "@landed/shared/types";

// Both ends of attributing a result to the prompt that produced it: the stamp taken when a run is
// CLAIMED, and the copy from the job onto the posting once the result lands.
//
// The claim is the moment the agent commits to the job and is immediately followed by its
// getContext call, so it is the closest the app can get to "the prompt this run actually read".
// Stamping at ingest instead would credit whichever version happened to be active by then — and
// switching versions while a job is in flight is exactly the normal way an experiment starts. A
// reclaim re-stamps, which is right: the retry genuinely reads whatever is active then.

// Claim time — called from jobs/queue.ts `tryClaim`. Nothing to stamp before the first version of a
// feature exists; the run then reads the seed body and stays in the unversioned baseline cohort.
export function stampClaimedPrompt(jobId: string, feature: PromptFeature) {
  const active = getActivePrompt(feature);
  if (active) db.update(jobs).set({ promptVersionId: active.id }).where(eq(jobs.id, jobId)).run();
}

// Post-ingest — called from the fit / tailoring JobDefs' `afterIngest`, the only ingest seam that
// gets the job's own context (`ingest` receives records and nothing else). Copies the claim-time
// stamp off the job row onto the posting the run produced.
export function recordPromptVersion(ctx: { jobId: string; params: Record<string, unknown> }, phase: RedoPhase) {
  const postingId = postingIdIn(ctx.params);
  if (postingId == null) return;
  const promptVersionId = db.select({ v: jobs.promptVersionId }).from(jobs).where(eq(jobs.id, ctx.jobId)).get()?.v;
  if (promptVersionId == null) return; // unversioned run (pre-versioning, or nothing active yet)

  const row = db.select({ redoLog: postings.redoLog }).from(postings).where(eq(postings.id, postingId)).get();
  if (!row) return;
  // The ingest that just ran appended this phase's agent turn; tag that turn so the per-version
  // history survives even after the projected column moves on to a later run.
  const log = parseRedoLog(row.redoLog);
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].phase === phase && log[i].role === "agent") {
      log[i] = { ...log[i], promptVersionId };
      break;
    }
  }
  db.update(postings)
    .set({
      ...(phase === "fit" ? { fitPromptVersionId: promptVersionId } : { tailorPromptVersionId: promptVersionId }),
      redoLog: JSON.stringify(log),
    })
    .where(eq(postings.id, postingId))
    .run();
}
