import { getThread, gmailConfigured } from "@landed/backend/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/gmail/thread/:id → { thread: GmailThread } — full thread by its X-GM-THRID (the id
// searchThreads returns). Backs the jobhunt MCP `getGmailThread` tool. 404 if the thread is gone.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!gmailConfigured()) return Response.json({ error: "gmail not configured" }, { status: 409 });
  const { id } = await params;
  try {
    const thread = await getThread(id);
    return thread ? Response.json({ thread }) : Response.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    return Response.json({ error: String((err as Error).message ?? err) }, { status: 500 });
  }
}
