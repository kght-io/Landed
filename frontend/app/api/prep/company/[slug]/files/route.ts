import { listPrepFiles } from "@landed/backend/prep/export-context";

export const dynamic = "force-dynamic";

// GET /api/prep/company/:slug/files — the markdown research outputs on disk for this company's prep
// folder (context.md, questions.md, …), newest first. These are the "context files" the locked-down
// prep chat reads and the chat panel lists, so you can see what the coach is working from. Empty
// array if nothing's been dumped yet (or the slug is unknown) — never an error.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return Response.json({ files: listPrepFiles(slug) });
}
