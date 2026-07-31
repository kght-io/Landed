import { resolvePendingMatch } from "@landed/core/agents/reconcile";

export const dynamic = "force-dynamic";

// POST /api/match  body: { id, decision: "apply" | "new" | "dismiss", appId? }
// Resolve an ambiguous ingestion match the user was asked to disambiguate.
export async function POST(request: Request) {
  let body: { id?: number; decision?: "apply" | "new" | "dismiss"; appId?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const { id, decision, appId } = body;
  if (!id || (decision !== "apply" && decision !== "new" && decision !== "dismiss"))
    return Response.json({ error: "need id + decision(apply|new|dismiss)" }, { status: 400 });

  const res = resolvePendingMatch(Number(id), decision, appId ? Number(appId) : undefined);
  return res.ok
    ? Response.json({ ok: true })
    : Response.json({ error: res.error ?? "failed" }, { status: 400 });
}
