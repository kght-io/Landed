import { archivePromptVersion, setActivePromptVersion } from "@landed/backend/db/prompts";

export const dynamic = "force-dynamic";

// PATCH /api/prompts/:id  body: { active?: true, archived?: true } -> activate or archive a version.
// There is deliberately no way to edit a version's body or delete it: a version is the immutable
// record of what produced a stored result, so "changing a prompt" means POSTing the next one.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const versionId = Number(id);
  if (!Number.isInteger(versionId)) return Response.json({ error: "bad id" }, { status: 400 });

  let body: { active?: unknown; archived?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    let version = body.active === true ? setActivePromptVersion(versionId) : null;
    if (body.archived === true) version = archivePromptVersion(versionId) ?? version;
    if (!version) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ version });
  } catch (err) {
    // Archiving the active version is refused by the store — surface the reason, not a 500.
    return Response.json({ error: String((err as Error)?.message ?? err) }, { status: 409 });
  }
}
