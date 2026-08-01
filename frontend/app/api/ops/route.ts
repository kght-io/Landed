import { opsSnapshot, storageUsage } from "@landed/backend/db/ops";
import { agentRunFiles } from "@landed/backend/agents/run-log";

export const dynamic = "force-dynamic";

// GET /api/ops → is the machine that runs the job search alive? The DB snapshot (queue, failures,
// inbox watermark) plus the on-disk state (agent run journals, files that grow without bound).
// The fs readers are composed here rather than inside opsSnapshot so the snapshot stays hermetic.
export async function GET() {
  try {
    return Response.json({ ...opsSnapshot(), agents: agentRunFiles(), storage: storageUsage() });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
