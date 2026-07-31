import { queuePrepResearch } from "@landed/backend/jobs/store";

export const dynamic = "force-dynamic";

// POST /api/applications/:id/prep — (re)queue the prep-research job for this posting's company,
// carrying its current first-hand intel (comp / team / rounds) as authoritative input. The drawer's
// "Generate prep" button. Idempotent on prep-research-<companyId> — supersedes any prior run.
// Returns { jobId } (or 404 if the posting is gone).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isInteger(appId)) return Response.json({ error: "bad id" }, { status: 400 });
  const result = queuePrepResearch(appId);
  return result ? Response.json(result) : Response.json({ error: "not found" }, { status: 404 });
}
