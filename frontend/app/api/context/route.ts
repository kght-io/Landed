import { agentPaths } from "@landed/backend/config";
import { getConfig } from "@landed/backend/db/config-store";
import { getLevelingRef } from "@landed/backend/db/profile";
import { agentProfile } from "@landed/backend/db/prompts";
import { listCriteria } from "@landed/backend/fitlab/store";

export const dynamic = "force-dynamic";

// GET /api/context -> the read-context the agent consults before self-initiating a job.
//   - inboxLastSynced: watermark so inbox-sync only fetches mail since the last run
//   - profile: the candidate's search identity (level + include/exclude disciplines + locations),
//     the source of truth for the scan's second pass and fit's leveling
//   - levelingRef: the reference ladder companies are normalized against (anchor + target rung), so
//     The agent normalizes collected levels.fyi ladders to the same scale the app draws against
//   - fitRubric: the criteria a fit assessment must return a verdict for — key, type, and the
//     judging definition. Handed over rather than left to be discovered: the agent has to use the
//     exact keys or its verdicts are discarded on ingest, and `type: "gate"` tells it which ones
//     veto (so it knows where `unmet` is expensive and `partial` is free).
//   - paths: resolved absolute asset paths (asset root, base résumé, resume dir), so a job that
//     touches disk never has to grep the source for ASSET_ROOT or rely on a shell var that isn't set
export async function GET() {
  try {
    return Response.json({
      inboxLastSynced: getConfig("inbox_last_synced") ?? null,
      profile: agentProfile(),
      levelingRef: getLevelingRef(),
      fitRubric: listCriteria()
        .filter((c) => c.active)
        .map((c) => ({ key: c.key, label: c.label, type: c.type, definition: c.definition })),
      paths: agentPaths(),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
