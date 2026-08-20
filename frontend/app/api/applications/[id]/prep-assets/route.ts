import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { emailsCapturedAt } from "@landed/backend/db/prep-assets";
import { PREP_ROOT, prepContextDumpedAt } from "@landed/backend/prep/export-context";
import { listTranscripts } from "@landed/backend/prep/transcripts";
import { listAttachmentFiles } from "@landed/backend/prep/attachments";
import { postingPrepSlug } from "@landed/backend/prep/slug";

export const dynamic = "force-dynamic";

// GET /api/applications/:id/prep-assets — the captured-vs-missing status for the drawer's prep
// materials panel: the inputs (emails, transcripts) + context.md, with timestamps and counts. Emails and transcripts come from the DB now (they used to be read off the files'
// mtimes); attachments are still artifacts on disk, and context.md is still a dump.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const slug = postingPrepSlug(id);
  if (!slug) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({
    slug,
    emails: { at: emailsCapturedAt(slug), attachments: listAttachmentFiles(slug) },
    transcripts: listTranscripts(slug),
    context: { at: prepContextDumpedAt(slug) },
  });
}

// POST /api/applications/:id/prep-assets  body: { action: "open" } — reveal the company's
// interview-prep folder in the OS file browser (local-only convenience; the server runs on the same
// machine). Best-effort, mirrors app/api/resume/open.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const slug = postingPrepSlug(id);
  if (!slug) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  if (body.action !== "open") return Response.json({ error: "unknown action" }, { status: 400 });
  const dir = path.join(PREP_ROOT, slug);
  fs.mkdirSync(dir, { recursive: true }); // the folder may not exist until the first dump
  if (process.platform === "darwin") {
    // Retarget the front Finder window if one is open (so repeat clicks reuse it), else open one.
    const script = `tell application "Finder"
  activate
  set p to (POSIX file ${JSON.stringify(dir)} as alias)
  if (count of windows) > 0 then
    set target of front window to p
  else
    open p
  end if
end tell`;
    execFile("osascript", ["-e", script], () => {});
  } else {
    execFile(process.platform === "win32" ? "explorer" : "xdg-open", [dir], () => {});
  }
  return Response.json({ ok: true, slug });
}
