import { queuedCountForType, takeDrainTrigger, setDrainTrigger } from "@landed/backend/jobs/store";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// GET /api/jobs/wait?type=fit&waitMs=25000 — LONG-POLL. Holds the request open, checking once a
// second, and returns the moment there's claimable work of `type` OR the user clicked "Drain"
// (a one-shot trigger). After waitMs with nothing, returns { ready:false } so the agent loops and
// calls again — keeping a pinned chat alive as an app-driven worker without a transport timeout.
//
// Capped at 28s: long enough to be efficient, short enough to stay under MCP/client timeouts.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  if (!type) return Response.json({ error: "missing type" }, { status: 400 });
  const waitMs = Math.min(Math.max(Number(url.searchParams.get("waitMs")) || 25_000, 1_000), 28_000);

  const start = Date.now();
  for (;;) {
    const count = queuedCountForType(type);
    if (count > 0) return Response.json({ ready: true, reason: "work", type, count });
    if (takeDrainTrigger(type)) return Response.json({ ready: true, reason: "trigger", type, count: 0 });
    if (Date.now() - start >= waitMs) return Response.json({ ready: false, type });
    // Bail early if the client (the agent chat) hung up — don't keep looping for a dead poll.
    if (request.signal.aborted) return Response.json({ ready: false, type, aborted: true });
    await sleep(1_000);
  }
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
