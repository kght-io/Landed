import { addComment, deleteComment, editComment } from "@landed/core/db/queries";

export const dynamic = "force-dynamic";

// POST /api/applications/:id/comment  body: { text }          → append a personal comment
// PATCH /api/applications/:id/comment body: { index, text }   → replace the comment at that index
// DELETE /api/applications/:id/comment body: { index }        → remove the comment at that index
// All return { posting } with the updated comment thread (or 404 if the posting is gone).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isInteger(appId)) return Response.json({ error: "bad id" }, { status: 400 });
  let body: { text?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  if (!body.text?.trim()) return Response.json({ error: "empty comment" }, { status: 400 });
  const posting = addComment(appId, body.text);
  return posting ? Response.json({ posting }) : Response.json({ error: "not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isInteger(appId)) return Response.json({ error: "bad id" }, { status: 400 });
  let body: { index?: number; text?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  if (typeof body.index !== "number") return Response.json({ error: "index required" }, { status: 400 });
  if (!body.text?.trim()) return Response.json({ error: "empty comment" }, { status: 400 });
  const posting = editComment(appId, body.index, body.text);
  return posting ? Response.json({ posting }) : Response.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isInteger(appId)) return Response.json({ error: "bad id" }, { status: 400 });
  let body: { index?: number };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  if (typeof body.index !== "number") return Response.json({ error: "index required" }, { status: 400 });
  const posting = deleteComment(appId, body.index);
  return posting ? Response.json({ posting }) : Response.json({ error: "not found" }, { status: 404 });
}
