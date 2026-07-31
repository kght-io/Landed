import { updateTodo, deleteTodo } from "@landed/core/db/todos";

export const dynamic = "force-dynamic";

// PATCH /api/todos/:id  body: { text?, done?, due? }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n)) return Response.json({ error: "bad id" }, { status: 400 });

  let body: { text?: string; done?: boolean; due?: string | null };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const todo = updateTodo(n, body);
  return todo
    ? Response.json({ todo })
    : Response.json({ error: "not found" }, { status: 404 });
}

// DELETE /api/todos/:id
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n)) return Response.json({ error: "bad id" }, { status: 400 });
  return deleteTodo(n)
    ? Response.json({ ok: true })
    : Response.json({ error: "not found" }, { status: 404 });
}
