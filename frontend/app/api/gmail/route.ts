import { gmailCredentials, saveGmailCredentials, clearGmailCredentials, testGmailConnection } from "@landed/backend/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET    /api/gmail            → { connected, user, source } — is Gmail wired up?
// POST   /api/gmail            { user, appPassword } → tests the login, saves on success → { ok, user }
// DELETE /api/gmail            → forget the stored app password → { ok }
export async function GET() {
  const creds = gmailCredentials();
  return Response.json({
    connected: !!creds,
    user: creds?.user ?? null,
    // env-provided creds can't be edited from the UI (they win over the stored ones)
    source: process.env.GMAIL_APP_PASSWORD ? "env" : creds ? "config" : null,
  });
}

export async function POST(request: Request) {
  let body: { user?: string; appPassword?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  const user = body.user?.trim();
  const pass = body.appPassword?.replace(/\s+/g, "");
  if (!user || !pass) return Response.json({ error: "user and appPassword required" }, { status: 400 });

  const test = await testGmailConnection({ user, pass });
  if (!test.ok) return Response.json({ ok: false, error: test.error ?? "login failed" }, { status: 400 });

  saveGmailCredentials(user, pass);
  return Response.json({ ok: true, user });
}

export async function DELETE() {
  clearGmailCredentials();
  return Response.json({ ok: true });
}
