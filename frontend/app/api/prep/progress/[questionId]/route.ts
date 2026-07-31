import { setProgress } from "@landed/backend/db/prep";

export const dynamic = "force-dynamic";

// PATCH /api/prep/progress/:questionId  body: { noted?, redo? }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ questionId: string }> }
) {
  const { questionId } = await params;
  if (!questionId) return Response.json({ error: "bad questionId" }, { status: 400 });

  let body: { noted?: boolean; redo?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const patch: { noted?: boolean; redo?: boolean } = {};
  if (typeof body.noted === "boolean") patch.noted = body.noted;
  if (typeof body.redo === "boolean") patch.redo = body.redo;
  return Response.json({ progress: setProgress(questionId, patch) });
}
