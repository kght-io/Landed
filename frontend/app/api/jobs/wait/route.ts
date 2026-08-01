import { waitForWork, setDrainTrigger } from "@landed/backend/jobs/store";

export const dynamic = "force-dynamic";

// GET /api/jobs/wait?type=fit&waitMs=25000 — LONG-POLL. Holds the request open and returns the
// moment there's claimable work of `type` OR the user clicked "Drain". The waiting itself is queue
// semantics and lives in the backend (jobs/wait.ts); this handler only adapts it to HTTP.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  if (!type) return Response.json({ error: "missing type" }, { status: 400 });

  const result = await waitForWork(type, {
    waitMs: url.searchParams.get("waitMs"),
    signal: request.signal, // the agent chat hung up — stop looping for a dead poll
  });
  return Response.json(result);
}

// POST /api/jobs/wait  body: { type } — the app's "Drain"/"Wake" button. Sets the one-shot trigger
// so a waiting chat of that type wakes on its next poll, even when there's no fresh queued work yet.
export async function POST(request: Request) {
  let type: string | undefined;
  try {
    type = (await request.json())?.type;
  } catch {
    // ignore
  }
  if (!type) return Response.json({ error: "missing type" }, { status: 400 });
  setDrainTrigger(type);
  return Response.json({ ok: true, type });
}
