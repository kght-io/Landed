import mammoth from "mammoth";
import { transcriptTextFrom, TRANSCRIPT_ACCEPT } from "@landed/shared/prep/transcript-import";
import { postingPrepSlug } from "@landed/backend/prep/slug";

export const dynamic = "force-dynamic";

// A transcript is a few hundred KB of text at the outside. The cap is here so a mis-drag of a video
// file fails fast instead of being read into memory.
const MAX_BYTES = 10 * 1024 * 1024;

// POST /api/applications/:id/transcript/extract — multipart form with `file`. Returns the file's
// TEXT; it does not save anything.
//
// Two steps on purpose. A transcript is stored as text, and a caption export needs cleaning before
// it's worth storing, so handing the extracted text back to the textarea lets you see what the parse
// produced — and add the round label — before committing it. Saving goes through the existing
// POST ../transcript, unchanged.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!postingPrepSlug(id)) return Response.json({ error: "not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "expected multipart form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "missing file" }, { status: 400 });

  const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  if (!(TRANSCRIPT_ACCEPT as readonly string[]).includes(ext))
    return Response.json(
      { error: `can't read ${ext || "a file with no extension"} — ${TRANSCRIPT_ACCEPT.join(", ")} only` },
      { status: 400 }
    );
  if (file.size > MAX_BYTES)
    return Response.json({ error: `file is larger than ${MAX_BYTES / 1024 / 1024}MB` }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());

  // .docx needs a real parser; everything else is text this decodes directly. mammoth is already a
  // dependency here (the base-résumé upload uses it).
  let text: string;
  if (ext === ".docx") {
    try {
      text = (await mammoth.extractRawText({ buffer: buf })).value ?? "";
    } catch {
      return Response.json({ error: "couldn't read that .docx" }, { status: 400 });
    }
  } else {
    text = transcriptTextFrom(file.name, buf.toString("utf8"));
  }

  if (!text.trim())
    return Response.json({ error: "that file had no readable text in it" }, { status: 400 });

  // The filename is a better default round label than nothing — it's usually the meeting title.
  const suggestedTitle = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return Response.json({ text, name: file.name, suggestedTitle, chars: text.length });
}
