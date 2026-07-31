import { getLevelingRef, setLevelingRef } from "@landed/backend/db/profile";
import type { LevelingRef } from "@landed/shared/leveling";

export const dynamic = "force-dynamic";

// GET /api/leveling-ref -> the reference ladder every company is drawn against (defaults if unset).
export async function GET() {
  return Response.json({ ref: getLevelingRef() });
}

// POST /api/leveling-ref  body: Partial<LevelingRef> -> merge + persist.
export async function POST(request: Request) {
  let body: Partial<LevelingRef>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  return Response.json({ ref: setLevelingRef(body) });
}
