import { setLabel } from "@landed/core/fitlab/store";
import type { Verdict } from "@landed/shared/fitlab/types";

export const dynamic = "force-dynamic";

const VERDICTS: Verdict[] = ["met", "partial", "unmet", "unclear", "na"];

// POST /api/fitlab/label  { verdictId, humanVerdict|null, humanNote? }
// Apply (or clear, with null) a human override on one verdict — the LABEL. Recomputes the run's
// decision and returns the updated run.
export async function POST(request: Request) {
  let body: { verdictId?: number; humanVerdict?: string | null; humanNote?: string | null };
  try { body = await request.json(); } catch { body = {}; }
  if (!body.verdictId) return Response.json({ error: "verdictId required" }, { status: 400 });
  const hv = body.humanVerdict ?? null;
  if (hv !== null && !VERDICTS.includes(hv as Verdict)) return Response.json({ error: "invalid verdict" }, { status: 400 });
  const run = setLabel(body.verdictId, hv as Verdict | null, body.humanNote ?? null);
  return run ? Response.json({ run }) : Response.json({ error: "verdict not found" }, { status: 404 });
}
