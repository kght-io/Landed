import { exportPrepContextFor } from "@landed/core/prep/export-context";

export const dynamic = "force-dynamic";

// POST /api/prep/company/:slug/export — dump this company's current context to
// <ASSET_ROOT>/interview-prep/<slug>/context.md (for an agent prep chat). Returns { at } = the
// ISO timestamp it was written, so the page can show "last dumped …". 404 if the slug is unknown.
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = exportPrepContextFor(slug);
  return result ? Response.json(result) : Response.json({ error: "unknown company" }, { status: 404 });
}
