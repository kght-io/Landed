import { getThreadAttachments, gmailConfigured } from "@landed/core/gmail";
import { saveAttachments } from "@landed/core/prep/attachments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/gmail/thread/:id/attachments  body: { slug } — download every file attached to a Gmail
// thread into interview-prep/<slug>/attachments/. Backs the jobhunt MCP `downloadGmailAttachments`
// tool (the app holds the IMAP connection; the agent only knows the thread id). Returns the saved
// filenames + sizes. 409 if Gmail isn't configured.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!gmailConfigured()) return Response.json({ error: "gmail not configured" }, { status: 409 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { slug?: unknown };
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  // slug is a canonical company key (lowercase alnum + dash) — reject anything else to avoid
  // writing outside the interview-prep tree.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return Response.json({ error: "bad slug" }, { status: 400 });
  try {
    const files = await getThreadAttachments(id);
    const saved = saveAttachments(slug, files);
    return Response.json({ slug, saved, count: saved.length });
  } catch (err) {
    return Response.json({ error: String((err as Error).message ?? err) }, { status: 500 });
  }
}
