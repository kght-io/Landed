import { claimJob } from "@landed/backend/jobs/store";

export const dynamic = "force-dynamic";

// POST /api/jobs/:id/claim  body: { by? } — an agent claims a queued job before working it, so two
// agents never run the same one. This is a try-acquire: it always answers 200 with a `claimed` flag
// (true + the job when this caller won the race; false when it's already claimed/ingested/missing),
// so the agent can branch on the body rather than handle an HTTP error.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });
  let by: string | undefined;
  try {
    by = (await request.json())?.by;
  } catch {
    // body is optional
  }
  // Stamp the claiming the agent chat (thread) — see claim-next route.
  const job = claimJob(id, by, request.headers.get("x-jobhunt-thread"));
  return job
    ? Response.json({ claimed: true, job })
    : Response.json({ claimed: false, reason: "not claimable (already claimed, ingested, or missing)" });
}
