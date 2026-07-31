import { enqueuePeerComp } from "@landed/backend/jobs/store";
import { getPeerComp } from "@landed/backend/jobs/peercomps";

export const dynamic = "force-dynamic";

// GET /api/peer-comp — the latest stored comparison (or null). The popup reads this to render the
// last run instantly, and re-reads it once the queued peer-comp job drains.
export async function GET() {
  return Response.json({ peerComp: getPeerComp() });
}

// POST /api/peer-comp — queue the GLOBAL peer-comp job for the agent (all LLM work goes through the job
// queue, never a direct API call). The agent researches + synthesizes the comparison and submits ONE
// { markdown } record, whose ingest stores it as the latest. Returns the queued job id.
export async function POST() {
  return Response.json(enqueuePeerComp());
}
