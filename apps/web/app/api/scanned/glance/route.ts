import { applyGlance, type GlanceInput } from "@landed/core/db/queries";

export const dynamic = "force-dynamic";

// POST /api/scanned/glance  body: { verdicts: GlanceInput[] }
// The agent's superficial second pass (title + location, no JD). Per posting: high | low | drop.
// high & low → the Watchlist "Scan results" tab for you to triage into Fit; drop → discarded. No fit
// job is auto-created — you add to Fit yourself. Creates the scanned row if it didn't exist yet.
export async function POST(request: Request) {
  let body: { verdicts?: GlanceInput[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const verdicts = Array.isArray(body?.verdicts) ? body.verdicts : [];
  let review = 0, discarded = 0, failed = 0;

  for (const v of verdicts) {
    if (!v?.company || (v.glance !== "high" && v.glance !== "low" && v.glance !== "drop")) { failed++; continue; }
    const r = applyGlance(v);
    if (!r.ok) { failed++; continue; }
    if (r.outcome === "review") review++;
    else discarded++;
  }

  return Response.json({ ok: true, review, discarded, failed });
}
