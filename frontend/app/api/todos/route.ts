import { listTodos, createTodo } from "@landed/backend/db/todos";

export const dynamic = "force-dynamic";

// GET /api/todos -> your to-do list
export async function GET() {
  try {
    return Response.json({ todos: listTodos() });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/todos  body: { text, due? }
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const text = String(body?.text ?? "").trim();
    if (!text) return Response.json({ error: "text required" }, { status: 400 });
    return Response.json({ todo: createTodo(text, body?.due || undefined) });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
