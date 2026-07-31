import { getRun, listRuns, listCriteria, labelStats } from "@landed/core/fitlab/store";
import { queueRun } from "@landed/core/fitlab/queue";

export const dynamic = "force-dynamic";

// GET /api/fitlab/run            → page bootstrap: { runs, criteria, labelStats }
// GET /api/fitlab/run?id=5       → { run } (single, with verdicts + trace; verdicts empty while pending)
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const run = getRun(Number(id));
    return run ? Response.json({ run }) : Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ runs: listRuns(), criteria: listCriteria(), labelStats: labelStats() });
}

// POST /api/fitlab/run
//   { postingId: 123 }        → assess an existing posting (loads its JD)
//   { company, role, jd }     → assess a pasted JD
// QUEUES a `fitlab-assess` job for the agent (Claude Code) — no direct LLM API. Returns { runId, jobId };
// the page polls GET ?id=runId until the agent submits the verdicts.
export async function POST(request: Request) {
  let body: { postingId?: number; company?: string; role?: string; jd?: string };
  try { body = await request.json(); } catch { body = {}; }
  try {
    const { runId, jobId } = queueRun(body);
    return Response.json({ runId, jobId, queued: true });
  } catch (err) {
    return Response.json({ error: String((err as Error)?.message ?? err) }, { status: 400 });
  }
}
