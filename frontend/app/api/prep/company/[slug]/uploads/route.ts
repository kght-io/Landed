import { savePrepUpload, listPrepUploads } from "@landed/backend/prep/uploads";

export const dynamic = "force-dynamic";

// GET /api/prep/company/:slug/uploads — the files you've attached to this company's prep chat.
// Kept apart from ../files (the agent's own research dumps): one is what the coach wrote, the other
// is what you handed it. Empty array for a company with none — never an error.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return Response.json({ uploads: await listPrepUploads(slug) });
}

// POST /api/prep/company/:slug/uploads — multipart form with one or more `file` parts. Saves each
// into that company's prep folder so the chat can name its path and the agent can Read it.
//
// Per-file errors are collected rather than thrown: attaching three screenshots and having the whole
// request fail because one was a .zip is worse than saving the two that were fine and saying so.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "expected multipart form-data" }, { status: 400 });
  }

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: "missing file" }, { status: 400 });

  const saved: Awaited<ReturnType<typeof savePrepUpload>>[] = [];
  const errors: { name: string; error: string }[] = [];
  for (const f of files) {
    try {
      saved.push(await savePrepUpload(slug, f.name, Buffer.from(await f.arrayBuffer())));
    } catch (e) {
      errors.push({ name: f.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  // Nothing landed → the request failed. Some landed → 200 with what went wrong alongside.
  if (!saved.length) return Response.json({ error: errors[0]?.error ?? "upload failed", errors }, { status: 400 });
  return Response.json({ uploads: saved, ...(errors.length ? { errors } : {}) });
}
