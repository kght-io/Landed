import { saveTranscript, listTranscripts } from "@landed/backend/prep/transcripts";
import { postingPrepSlug } from "@landed/backend/prep/slug";

export const dynamic = "force-dynamic";

// GET /api/applications/:id/transcript — list the call transcripts dropped for this company.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const slug = postingPrepSlug(id);
  if (!slug) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ slug, transcripts: listTranscripts(slug) });
}

// POST /api/applications/:id/transcript — write a pasted transcript into interview-prep/<slug>/
// transcripts/ as a fresh numbered file (the app can't record calls). Body: { body, title? }.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const slug = postingPrepSlug(id);
  if (!slug) return Response.json({ error: "not found" }, { status: 404 });
  const payload = (await request.json().catch(() => ({}))) as { body?: unknown; title?: unknown };
  const text = typeof payload.body === "string" ? payload.body : "";
  if (!text.trim()) return Response.json({ error: "empty transcript" }, { status: 400 });
  const title = typeof payload.title === "string" ? payload.title : undefined;
  const file = saveTranscript(slug, text, title);
  return Response.json({ slug, file, transcripts: listTranscripts(slug) });
}
