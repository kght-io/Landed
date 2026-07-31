import { resolveReview } from "@landed/core/db/queries";

export const dynamic = "force-dynamic";

// POST /api/review  body: { id, decision: "confirm" | "reject" }
export async function POST(request: Request) {
  let body: { id?: number; decision?: "confirm" | "reject" };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.id || (body.decision !== "confirm" && body.decision !== "reject"))
    return Response.json({ error: "need id + decision(confirm|reject)" }, { status: 400 });

  const posting = resolveReview(Number(body.id), body.decision);
  return posting
    ? Response.json({ posting })
    : Response.json({ error: "not found" }, { status: 404 });
}
