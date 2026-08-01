import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PATHS, resolveResume } from "@landed/backend/config";
import { lineDiff } from "@landed/shared/util/linediff";

export const dynamic = "force-dynamic";

const pexec = promisify(execFile);

// Extract plain text from a .docx via macOS `textutil` (no dependency; the server runs locally).
async function docxText(file: string): Promise<string> {
  const { stdout } = await pexec("textutil", ["-convert", "txt", "-stdout", file], { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

// GET /api/resume/diff?slug=<resumeDir> — text-diff the tailored resume against the base resume,
// returned as git-style ops. Diffs the *text* (textutil-extracted), not formatting/layout.
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")?.trim();
  if (!slug) return Response.json({ error: "missing slug" }, { status: 400 });
  if (process.platform !== "darwin") {
    return Response.json({ error: "resume diff needs macOS textutil" }, { status: 501 });
  }

  const baseFile = PATHS.baseResume("docx");
  const dir = resolveResume(slug);
  if (!dir) return Response.json({ error: "bad slug" }, { status: 400 });
  const tailoredFile = path.join(dir, "resume.docx");

  if (!existsSync(baseFile)) return Response.json({ error: "base resume not found", baseFile }, { status: 404 });
  if (!existsSync(tailoredFile)) return Response.json({ error: "tailored resume not found", slug }, { status: 404 });

  let ops;
  try {
    const [baseTxt, tailoredTxt] = await Promise.all([docxText(baseFile), docxText(tailoredFile)]);
    ops = lineDiff(baseTxt, tailoredTxt);
  } catch (e) {
    return Response.json({ error: "could not read resumes", detail: String(e) }, { status: 500 });
  }

  const added = ops.filter((o) => o.type === "add").length;
  const removed = ops.filter((o) => o.type === "del").length;
  return Response.json({ ok: true, slug, base: path.basename(baseFile), added, removed, ops });
}
