import { searchThreads, gmailConfigured } from "@landed/backend/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/gmail/search?q=<gmail query>&limit=<n> → { threads: GmailThreadSummary[] }
// `q` uses Gmail's normal search syntax (after:, -category:promotions, filename:invite.ics, …) via
// IMAP X-GM-RAW. Backs the jobhunt MCP `searchGmail` tool used by inbox-sync.
export async function GET(request: Request) {
  if (!gmailConfigured()) return Response.json({ error: "gmail not configured" }, { status: 409 });
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  if (!q) return Response.json({ error: "q (query) required" }, { status: 400 });
  const limit = Number(url.searchParams.get("limit")) || 50;
  try {
    return Response.json({ threads: await searchThreads(q, limit) });
  } catch (err) {
    return Response.json({ error: String((err as Error).message ?? err) }, { status: 500 });
  }
}
