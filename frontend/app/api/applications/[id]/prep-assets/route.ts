import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getPosting } from "@landed/backend/db/queries";
import { canonical } from "@landed/shared/agents/canonical";
import { getCompanyProfile } from "@landed/backend/db/prep";
import { PREP_ROOT, prepContextDumpedAt } from "@landed/backend/prep/export-context";
import { listTranscripts } from "@landed/backend/prep/transcripts";
import { listAttachments } from "@landed/backend/prep/attachments";

export const dynamic = "force-dynamic";

// Resolve a posting id → its company's interview-prep folder slug (the same key the exporter, brief,
// and pull jobs use). Null when the id is bad or the posting is gone.
function slugFor(id: string): string | null {
  const appId = Number(id);
  if (!Number.isInteger(appId)) return null;
  const p = getPosting(appId);
  return p ? (canonical(p.company)?.key ?? null) : null;
}

const mtime = (file: string): string | null => {
  try { return fs.statSync(file).mtime.toISOString(); } catch { return null; }
};

// GET /api/applications/:id/prep-assets — the dumped-vs-missing status for the drawer's prep
// materials panel: the three inputs (emails, questions, transcripts) + context.md, with timestamps
// and counts. Everything read-only off disk + the prep profile.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const slug = slugFor(id);
  if (!slug) return Response.json({ error: "not found" }, { status: 404 });
  const profile = getCompanyProfile(slug);
  return Response.json({
    slug,
    emails: { at: mtime(path.join(PREP_ROOT, slug, "emails.md")), files: listAttachments(slug).length },
    questions: { researchedAt: profile?.researchedAt ?? null },
    transcripts: listTranscripts(slug),
    context: { at: prepContextDumpedAt(slug) },
  });
}

// POST /api/applications/:id/prep-assets  body: { action: "open" } — reveal the company's
// interview-prep folder in the OS file browser (local-only convenience; the server runs on the same
// machine). Best-effort, mirrors app/api/resume/open.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const slug = slugFor(id);
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
