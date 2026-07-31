import { getPosting } from "@landed/core/db/queries";
import { canonical } from "@landed/shared/agents/canonical";
import { saveTranscript, listTranscripts } from "@landed/core/prep/transcripts";

export const dynamic = "force-dynamic";

// Resolve a posting id → the company's interview-prep folder slug (same key the exporter + brief job
// use). Null when the id is bad or the posting is gone.
function slugFor(id: string): string | null {
  const appId = Number(id);
  if (!Number.isInteger(appId)) return null;
  const p = getPosting(appId);
  return p ? (canonical(p.company)?.key ?? null) : null;
}

// GET /api/applications/:id/transcript — list the call transcripts dropped for this company.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const slug = slugFor(id);
  if (!slug) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ slug, transcripts: listTranscripts(slug) });
}

// POST /api/applications/:id/transcript — write a pasted transcript into interview-prep/<slug>/
// transcripts/ as a fresh numbered file (the app can't record calls). Body: { body, title? }.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const slug = slugFor(id);
  if (!slug) return Response.json({ error: "not found" }, { status: 404 });
  const payload = (await request.json().catch(() => ({}))) as { body?: unknown; title?: unknown };
  const text = typeof payload.body === "string" ? payload.body : "";
  if (!text.trim()) return Response.json({ error: "empty transcript" }, { status: 400 });
  const title = typeof payload.title === "string" ? payload.title : undefined;
  const file = saveTranscript(slug, text, title);
  return Response.json({ slug, file, transcripts: listTranscripts(slug) });
}
