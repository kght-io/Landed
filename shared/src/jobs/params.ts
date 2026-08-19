import { num } from "../util/coerce";

// The posting a fit/tailoring job is a projection of. `params.postings` stays an ARRAY on the wire
// (the playbooks and the agent read it that way), but every path that creates one of these jobs
// writes exactly one entry — the job id is per-posting — so app code reads the first and stops.
//
// One definition, because three places key off it: the job view (backend/src/jobs/queue.ts), the
// claim-time prompt stamp, and the post-ingest one (backend/src/jobs/prompt-stamp.ts). A second
// copy of the convention would let them disagree about which posting a job belongs to — and the
// stamps would then attribute a result to the wrong posting rather than fail loudly.
export const postingIdIn = (params: Record<string, unknown>): number | null =>
  num((params.postings as { id?: unknown }[] | undefined)?.[0]?.id);
