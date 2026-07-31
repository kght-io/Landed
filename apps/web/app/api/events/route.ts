import { listEvents, listNeedsReview, listPendingMatches } from "@landed/core/db/queries";

export const dynamic = "force-dynamic";

// GET /api/events -> the change-log feed + the pending review queue + ambiguous matches
export async function GET() {
  try {
    return Response.json({
      events: listEvents(),
      needsReview: listNeedsReview(),
      pendingMatches: listPendingMatches(),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
