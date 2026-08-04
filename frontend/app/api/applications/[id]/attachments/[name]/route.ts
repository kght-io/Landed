import fs from "node:fs";
import path from "node:path";
import { resolveAttachment } from "@landed/backend/prep/attachments";
import { postingPrepSlug } from "@landed/backend/prep/slug";

export const dynamic = "force-dynamic";

// The types recruiters actually send. Anything else downloads rather than renders — an unknown type
// is not worth guessing at when the browser will happily execute what we claim it is.
const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

// GET /api/applications/:id/attachments/:name — serve one file the "Pull interview emails" job
// downloaded into interview-prep/<slug>/attachments/, so the drawer can link a stage's prep guide /
// take-home PDF instead of only revealing the folder in Finder. Read-only; the name is checked
// against what saveAttachments would have written, so it can't escape the company's folder.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await params;
  const slug = postingPrepSlug(id);
  if (!slug) return Response.json({ error: "not found" }, { status: 404 });

  const file = resolveAttachment(slug, decodeURIComponent(name));
  if (!file) return Response.json({ error: "not found" }, { status: 404 });

  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file); // a Buffer IS a Uint8Array — wrapping it would copy every byte
  return new Response(body, {
    headers: {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      // inline so a PDF opens in the browser tab; the filename still drives a "save as".
      "content-disposition": `inline; filename="${path.basename(file).replace(/"/g, "")}"`,
      "content-length": String(body.byteLength), // lets the browser show progress on a fat PDF
      // saveAttachments never overwrites (a colliding name becomes role-1.pdf), so these bytes are
      // stable — reopening a prep guide shouldn't re-read it. Kept short: deleting the folder and
      // re-pulling is the one path that can reuse a name, and an hour heals that on its own.
      "cache-control": "private, max-age=3600",
    },
  });
}
