import { getProfile, setProfile } from "@landed/backend/fitlab/store";

export const dynamic = "force-dynamic";

// The candidate profile — the résumé TEXT the fit and leveling playbooks judge against (auto-adopted
// from an uploaded base résumé, editable on the Profile page).
// GET  /api/resume/profile → { profile }
// POST /api/resume/profile { profile } → save it
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
