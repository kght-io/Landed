import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { ASSET_ROOT, INSTRUCTIONS_ROOT } from "@landed/backend/config";

export const dynamic = "force-dynamic";

// GET /api/config/paths — the resolved asset/instructions roots, for display on the settings page.
// Read-only: relocating ASSET_ROOT is a .env edit + restart (it's an import-time constant).
export async function GET() {
  return Response.json({ assetRoot: ASSET_ROOT, instructionsRoot: INSTRUCTIONS_ROOT });
}

// POST /api/config/paths — reveal the asset folder in the OS file browser. Local-only convenience
// (the server runs on the same machine), best-effort.
export async function POST() {
  if (!existsSync(ASSET_ROOT)) return Response.json({ error: "asset folder not found", ASSET_ROOT }, { status: 404 });
  if (process.platform === "darwin") execFile("open", [ASSET_ROOT], () => {});
  else execFile(process.platform === "win32" ? "explorer" : "xdg-open", [ASSET_ROOT], () => {});
  return Response.json({ ok: true });
}
