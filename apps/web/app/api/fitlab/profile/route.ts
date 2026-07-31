import { getProfile, setProfile } from "@landed/core/fitlab/store";

export const dynamic = "force-dynamic";

// GET  /api/fitlab/profile → { profile }   (the resume text the assessor judges against)
// POST /api/fitlab/profile { profile }     → save it
export async function GET() {
  return Response.json({ profile: getProfile() });
}

export async function POST(request: Request) {
  let body: { profile?: string };
  try { body = await request.json(); } catch { body = {}; }
  if (typeof body.profile !== "string") return Response.json({ error: "profile required" }, { status: 400 });
  setProfile(body.profile);
  return Response.json({ ok: true });
}
