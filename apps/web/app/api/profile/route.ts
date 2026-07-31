import { getProfile, setProfile, type Profile } from "@landed/core/db/profile";

export const dynamic = "force-dynamic";

// GET /api/profile -> the search-identity profile (defaults if never set).
export async function GET() {
  return Response.json({ profile: getProfile() });
}

// POST /api/profile  body: Partial<Profile> -> merge + persist.
export async function POST(request: Request) {
  let body: Partial<Profile>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  return Response.json({ profile: setProfile(body) });
}
