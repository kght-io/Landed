import { readFile } from "node:fs/promises";
import { resolveInstruction } from "@landed/backend/config";

export const dynamic = "force-dynamic";

// GET /api/instructions/file?path=tailoring.md -> { content }
// Read-only: instructions carry the agents' MCP wiring + operating rules, so they're edited in the
// repo (instructions/), not the UI. There is deliberately no write route here.
export async function GET(request: Request) {
  const rel = new URL(request.url).searchParams.get("path");
  if (!rel) return Response.json({ error: "missing path" }, { status: 400 });
  const full = resolveInstruction(rel);
  if (!full) return Response.json({ error: "invalid path" }, { status: 400 });
  try {
    const content = await readFile(full, "utf8");
    return Response.json({ path: rel, content });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 404 });
  }
}
