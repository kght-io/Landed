import { requeueJob } from "@landed/backend/jobs/store";

export const dynamic = "force-dynamic";

// POST /api/jobs/:id/requeue — the user's manual recovery for a stuck job: an agent claimed it
// (status wip) but never finished, or it failed. Returns it to the queue (clearing the claim) so
// another agent can pick it up. Only wip/failed rows requeue; otherwise 404.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });
  const ok = requeueJob(id);
  return ok ? Response.json({ ok }) : Response.json({ error: "not found or not requeueable" }, { status: 404 });
}
