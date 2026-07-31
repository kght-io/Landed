import { listFitQueue, enqueueFit } from "@landed/backend/jobs/store";

export const dynamic = "force-dynamic";

// GET /api/jobs/fit -> postings awaiting the agent's fit assessment
export async function GET() {
  try {
    return Response.json({ queue: listFitQueue() });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/jobs/fit  body: { company, role?, jd } -> queue a fit job (your "+ add")
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const company = String(body?.company ?? "").trim();
    const jd = String(body?.jd ?? "").trim();
    if (!company) return Response.json({ error: "company required" }, { status: 400 });
    if (!jd) return Response.json({ error: "jd required" }, { status: 400 });
    const item = enqueueFit({ company, role: body?.role, jd, url: body?.url });
    return Response.json({ item });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
