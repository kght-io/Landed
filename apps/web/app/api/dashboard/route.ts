import { dashboardStats } from "@landed/core/db/dashboard";

export const dynamic = "force-dynamic";

// GET /api/dashboard → aggregate job-hunt stats (funnel, outcomes, weekly applications, agent + prep).
export async function GET() {
  try {
    return Response.json(dashboardStats());
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
