import { addInterviewRound, updateInterviewRound, deleteInterviewRound } from "@landed/backend/db/queries";
import type { InterviewKind, InterviewRound } from "@landed/shared/types";

export const dynamic = "force-dynamic";

// Hand-authored interview rounds for a posting (the recruiter-described loop). Inbox-sync writes the
// same `interviews` table via upsertInterviews, so synced + hand-authored rounds coexist.
//
// POST   /api/applications/:id/rounds  body: { kind?, date?, notes?, outcome? }   → append a round
// PATCH  /api/applications/:id/rounds  body: { roundId, ...patch }                → edit one round
// DELETE /api/applications/:id/rounds  body: { roundId }                          → remove one round
// All return { posting } with the refreshed rounds (or 404 if the posting/round is gone).

type RoundFields = Pick<InterviewRound, "kind" | "date" | "outcome" | "notes">;

// Keep only the round fields off a loose JSON body (ignore round/id/emailId — those are managed).
function pickRound(body: Record<string, unknown>): RoundFields {
  const out: RoundFields = {};
  if (typeof body.kind === "string") out.kind = body.kind as InterviewKind;
  if (typeof body.date === "string") out.date = body.date;
  if (typeof body.notes === "string") out.notes = body.notes;
  if (body.outcome === "passed" || body.outcome === "rejected" || body.outcome === "pending") out.outcome = body.outcome;
  return out;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isInteger(appId)) return Response.json({ error: "bad id" }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  const posting = addInterviewRound(appId, pickRound(body));
  return posting ? Response.json({ posting }) : Response.json({ error: "not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isInteger(appId)) return Response.json({ error: "bad id" }, { status: 400 });
  let body: Record<string, unknown> & { roundId?: number };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  if (typeof body.roundId !== "number") return Response.json({ error: "roundId required" }, { status: 400 });
  const posting = updateInterviewRound(body.roundId, pickRound(body));
  return posting ? Response.json({ posting }) : Response.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isInteger(appId)) return Response.json({ error: "bad id" }, { status: 400 });
  let body: { roundId?: number };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  if (typeof body.roundId !== "number") return Response.json({ error: "roundId required" }, { status: 400 });
  const posting = deleteInterviewRound(body.roundId);
  return posting ? Response.json({ posting }) : Response.json({ error: "not found" }, { status: 404 });
}
