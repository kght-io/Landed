import { mkdir, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { PATHS } from "@landed/core/config";
import { getProfile, setProfile } from "@landed/core/fitlab/store";
import { PROFILE_SEED } from "@landed/core/fitlab/seed";

export const dynamic = "force-dynamic";

// GET /api/resume/upload — status of the base résumé docx (the tailoring source of truth).
export async function GET() {
  const dest = PATHS.baseResume("docx");
  if (!existsSync(dest)) return Response.json({ exists: false, name: path.basename(dest) });
  const s = await stat(dest);
  return Response.json({ exists: true, name: path.basename(dest), bytes: s.size, mtime: s.mtime.toISOString() });
}

// POST /api/resume/upload — multipart form with `file` (a .docx). Saves it as the base résumé.
// docx only: the docx is the source; the docx+pdf pair is generated PER TAILORED resume by the agent.
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "expected multipart form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "missing file" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".docx"))
    return Response.json({ error: "base résumé must be a .docx" }, { status: 400 });

  const dest = PATHS.baseResume("docx");
  await mkdir(path.dirname(dest), { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(dest, buf);

  // Extract the résumé text (cross-platform, no native converter) to feed the candidate profile the
  // fit/leveling playbooks judge against. Auto-adopt only when the profile is still the untouched
  // seed; otherwise hand it back so the UI can offer to replace without clobbering hand-edits.
  let extractedText = "";
  try {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    extractedText = value?.trim() ?? "";
  } catch {
    /* extraction is best-effort — a failed parse just means no profile prefill */
  }
  let profileUpdated = false;
  if (extractedText) {
    const current = getProfile().trim();
    if (current === "" || current === PROFILE_SEED.trim()) {
      setProfile(extractedText);
      profileUpdated = true;
    }
  }

  return Response.json({
    ok: true,
    name: path.basename(dest),
    bytes: buf.length,
    extractedChars: extractedText.length,
    profileUpdated,
    // Only return the text when we did NOT auto-adopt, so the UI can offer it explicitly.
    extractedText: profileUpdated ? undefined : extractedText || undefined,
  });
}
