import { deleteQueuedJob, requeueJob } from "@landed/core/jobs/store";

export const dynamic = "force-dynamic";

// DELETE /api/jobs/:id — drop a queued job from the agent queue. Only `queued` jobs can be
// removed (ingested rows are history); a no-op delete returns 404.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });
  const ok = deleteQueuedJob(id);
  return ok ? Response.json({ ok }) : Response.json({ error: "not found or not queued" }, { status: 404 });
}

// POST /api/jobs/:id/retry → re-queue a failed/stuck job with a fresh attempt budget (the "Retry"
// button on the needs-attention surface). Routed by the `?action=retry` query for simplicity.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });
  if (new URL(request.url).searchParams.get("action") !== "retry")
    return Response.json({ error: "unknown action" }, { status: 400 });
  const ok = requeueJob(id);
  return ok ? Response.json({ ok }) : Response.json({ error: "not found" }, { status: 404 });
}
