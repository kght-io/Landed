import { getConfig } from "@landed/backend/db/config-store";
import { getProfile, getLevelingRef } from "@landed/backend/db/profile";

export const dynamic = "force-dynamic";

// GET /api/context -> the read-context the agent consults before self-initiating a job.
//   - inboxLastSynced: watermark so inbox-sync only fetches mail since the last run
//   - profile: the candidate's search identity (level + include/exclude disciplines + locations),
//     the source of truth for the scan's second pass and fit's leveling
//   - levelingRef: the reference ladder companies are normalized against (anchor + target rung), so
//     The agent normalizes collected levels.fyi ladders to the same scale the app draws against
export async function GET() {
  try {
    return Response.json({
      inboxLastSynced: getConfig("inbox_last_synced") ?? null,
      profile: getProfile(),
      levelingRef: getLevelingRef(),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
