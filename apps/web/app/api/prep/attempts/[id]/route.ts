import { deleteAttempt } from "@landed/core/db/prep";

export const dynamic = "force-dynamic";

// DELETE /api/prep/attempts/:id  -> undo a logged attempt
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n)) return Response.json({ error: "bad id" }, { status: 400 });
  return deleteAttempt(n)
    ? Response.json({ ok: true })
    : Response.json({ error: "not found" }, { status: 404 });
}
