import { logAttempt, type AttemptStatus } from "@landed/backend/db/prep";

export const dynamic = "force-dynamic";

const STATUSES: AttemptStatus[] = ["solved", "partial", "failed"];

// POST /api/prep/attempts  body: { questionId, durationSec?, status?, notes? }
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const questionId = String(body?.questionId ?? "").trim();
    if (!questionId) return Response.json({ error: "questionId required" }, { status: 400 });

    const status: AttemptStatus = STATUSES.includes(body?.status) ? body.status : "solved";
    const durationSec =
      body?.durationSec == null || body.durationSec === "" ? undefined : Number(body.durationSec);
    if (durationSec != null && !Number.isFinite(durationSec))
      return Response.json({ error: "bad durationSec" }, { status: 400 });

    return Response.json(
      logAttempt({ questionId, durationSec, status, notes: body?.notes || undefined })
    );
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
