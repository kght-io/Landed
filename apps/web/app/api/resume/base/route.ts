import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { PATHS } from "@landed/core/config";

export const dynamic = "force-dynamic";

// GET /api/resume/base — stream the base (untailored) résumé PDF inline, so the drawer can link to it.
// Local file under ASSET_ROOT/resume/resume-ref.pdf; 404 if there's no PDF export yet.
export async function GET() {
  const file = PATHS.baseResume("pdf");
  if (!existsSync(file)) return Response.json({ error: "base résumé PDF not found", file }, { status: 404 });
  const buf = await readFile(file);
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="base-resume.pdf"' },
  });
}
