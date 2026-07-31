import { getPosting, updateApplication, setTierForApplication, setCompanyName, moveApplicationToCompany, deleteApplication, type ApplicationPatch } from "@landed/backend/db/queries";
import { syncTailoringJob, removeTailoringJob } from "@landed/backend/jobs/store";
import type { Tier } from "@landed/shared/types";

export const dynamic = "force-dynamic";

// Who's making this write? The MCP bridge (the agent) tags its requests with x-jobhunt-actor; the
// app's own UI sends nothing, so its edits stay attributed to the human (You) by default. This
// keeps the change log honest — e.g. the agent's inbox-sync corrections via the `updateApplication`
// MCP tool show up as the agent, not You.
const actorFromRequest = (req: Request): string | undefined =>
  req.headers.get("x-jobhunt-actor")?.trim() || undefined;

// GET /api/applications/:id — one posting in ANY stage (the tracker list is tracker-only, so the
// funnel uses this to open a pre-apply candidate, e.g. a tailoring row, in the editable drawer).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isInteger(appId)) return Response.json({ error: "bad id" }, { status: 400 });
  const posting = getPosting(appId);
  return posting ? Response.json({ posting }) : Response.json({ error: "not found" }, { status: 404 });
}

// PATCH /api/applications/:id  body: ApplicationPatch & { tier?: Tier }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isInteger(appId)) return Response.json({ error: "bad id" }, { status: 400 });

  let body: ApplicationPatch & { tier?: Tier; companyName?: string; moveToCompany?: string; keepTailoringJob?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const actor = actorFromRequest(request);
  // keepTailoringJob is a control flag (not a posting field) — pull it out so it never reaches
  // updateApplication as a column write. It spares a queued tailoring job from the stage-exit drop.
  const { tier, companyName, moveToCompany, keepTailoringJob, ...patch } = body;
  let updated = Object.keys(patch).length ? updateApplication(appId, patch, actor) : null;
  if (tier) updated = setTierForApplication(appId, tier, actor) ?? updated;
  if (companyName != null) updated = setCompanyName(appId, companyName, actor) ?? updated; // rename company (all postings)
  if (moveToCompany != null) updated = moveApplicationToCompany(appId, moveToCompany, actor) ?? updated; // move this posting
  if (!updated) updated = updateApplication(appId, {}, actor); // no-op refresh

  if (updated) {
    syncTailoringJob(updated, { keepPending: !!keepTailoringJob }); // queue/drop a tailoring job as the posting enters/leaves Queued
  }

  return updated
    ? Response.json({ posting: updated })
    : Response.json({ error: "not found" }, { status: 404 });
}

// DELETE /api/applications/:id — hard-delete one posting completely.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isInteger(appId)) return Response.json({ error: "bad id" }, { status: 400 });

  const deleted = deleteApplication(appId, actorFromRequest(request));
  if (!deleted) return Response.json({ error: "not found" }, { status: 404 });

  removeTailoringJob(appId); // drop any queued tailoring job for this posting

  return Response.json({ deleted: true });
}
