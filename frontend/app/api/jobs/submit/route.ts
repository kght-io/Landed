import { submitJobResult } from "@landed/backend/jobs/store";

export const dynamic = "force-dynamic";

// POST /api/jobs/submit  body: { type, records[], jobId?, createdBy?, dryRun? }
// The MCP write path (submitJobResult tool): the agent hands a job's result records back
// directly instead of dropping results/<id>.json. Runs the type's ingest() → reconcile
// (dedup + needsReview gate) and records the ledger row. Set dryRun to preview the change
// without persisting. Returns the reconcile summary + details.
export async function POST(request: Request) {
  let body: { type?: string; records?: unknown; jobId?: string; createdBy?: string; dryRun?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.type || typeof body.type !== "string")
    return Response.json({ error: "type required" }, { status: 400 });
  if (!Array.isArray(body.records))
    return Response.json({ error: "records must be an array" }, { status: 400 });

  try {
    const result = submitJobResult({
      type: body.type,
      records: body.records as Record<string, unknown>[],
      jobId: body.jobId,
      createdBy: body.createdBy,
      dryRun: body.dryRun,
    });
    return Response.json({ result });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
