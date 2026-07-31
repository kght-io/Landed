import { registerThread } from "@landed/backend/threads";

export const dynamic = "force-dynamic";

// POST /api/threads/hello — the MCP server fires this on `initialize` so an agent chat shows up the
// moment it connects, before it claims any work. Body: { threadId, label?, pid? }. Idempotent.
export async function POST(request: Request) {
  try {
    const b = await request.json();
    if (b?.threadId) registerThread({ id: String(b.threadId), label: b.label ?? null, pid: b.pid ?? null });
  } catch {
    // best-effort — swallow
  }
  return Response.json({ ok: true });
}
