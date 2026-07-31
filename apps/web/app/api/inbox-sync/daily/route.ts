import { enqueueDailyInboxSync } from "@landed/core/jobs/store";

export const dynamic = "force-dynamic";

// POST /api/inbox-sync/daily  body: { id }  -> queue the day's scheduled inbox-sync, at most once.
//
// Deliberately NOT the generic POST /api/jobs: that mints a unique id per call, so every repeat
// tick (double-invoked effect, second tab, a tick inside the queue-poll gap) stacked another sync.
// `id` is the caller's day key from `dailySyncJobId` and the store does the deduping, so "once a
// day" is enforced by the DB rather than by client state. Returns whether it queued.
export async function POST(request: Request) {
  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const id = body.id?.trim();
  // Only ever queue day-keyed ids — this route must not be a way to (re)queue an arbitrary job.
  if (!id || !/^inbox-sync-daily-\d{4}-\d{2}-\d{2}$/.test(id))
    return Response.json({ error: "expected a daily inbox-sync id" }, { status: 400 });
  try {
    return Response.json({ queued: enqueueDailyInboxSync(id) });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
