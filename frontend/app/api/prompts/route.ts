import { createPromptVersion, listPromptVersions } from "@landed/backend/db/prompts";
import { PROMPT_FEATURES, type PromptFeature } from "@landed/shared/db/enums";

export const dynamic = "force-dynamic";

const isFeature = (v: unknown): v is PromptFeature =>
  typeof v === "string" && (PROMPT_FEATURES as readonly string[]).includes(v);

// GET /api/prompts?feature=fit&all=1 -> the versioned judgment prompts, newest first.
// `all=1` includes archived ones (a stored result still has to resolve to the prompt that made it).
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const raw = q.get("feature");
    if (raw !== null && !isFeature(raw)) return Response.json({ error: "unknown feature" }, { status: 400 });
    const versions = listPromptVersions(raw ?? undefined, { includeArchived: q.get("all") === "1" });
    return Response.json({ versions });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/prompts  body: { feature, body, label? } -> append the next version for that feature.
// Saving never switches which version runs — that's an explicit activate (see [id]/route.ts).
export async function POST(request: Request) {
  let payload: { feature?: unknown; body?: unknown; label?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!isFeature(payload.feature)) return Response.json({ error: "feature required" }, { status: 400 });
  if (typeof payload.body !== "string" || !payload.body.trim())
    return Response.json({ error: "body required" }, { status: 400 });
  const label = typeof payload.label === "string" ? payload.label : null;
  return Response.json({ version: createPromptVersion(payload.feature, payload.body, label) });
}
