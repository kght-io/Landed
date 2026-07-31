import { requeueRedo } from "@landed/backend/jobs/store";
import type { RedoPhase } from "@landed/shared/types";

export const dynamic = "force-dynamic";

// POST /api/applications/:id/redo  body: { phase: "fit" | "tailor", note }
// Append a user redo note to the posting's conversation and re-queue that phase's job at the next
// version. The agent picks it up the next time the queue is drained.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isInteger(appId)) return Response.json({ error: "bad id" }, { status: 400 });

  let body: { phase?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const phase: RedoPhase | null = body.phase === "fit" || body.phase === "tailor" ? body.phase : null;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!phase) return Response.json({ error: "phase must be 'fit' or 'tailor'" }, { status: 400 });
  if (!note) return Response.json({ error: "a redo note is required" }, { status: 400 });

  const result = requeueRedo(appId, phase, note);
  return result ? Response.json({ ok: true, ...result }) : Response.json({ error: "not found" }, { status: 404 });
}
