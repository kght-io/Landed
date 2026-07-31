import { enqueueInterviewBrief } from "@landed/backend/jobs/store";

export const dynamic = "force-dynamic";

// POST /api/applications/:id/interview-brief — (re)queue the interview-brief job for this posting.
// The agent reads the company's interview-prep asset folder (context.md + dropped transcripts + fetched
// emails) and returns a versioned brief. The drawer's "Generate interview brief" button. Idempotent
// on interview-brief-<postingId> — supersedes any prior run. Returns { jobId, slug } (or 404).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isInteger(appId)) return Response.json({ error: "bad id" }, { status: 400 });
  const result = enqueueInterviewBrief(appId);
  return result ? Response.json(result) : Response.json({ error: "not found" }, { status: 404 });
}
