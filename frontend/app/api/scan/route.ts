import { scanCompany, scanWatchlist } from "@landed/backend/jobs/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // external board fetches can take a few seconds each

// POST /api/scan
//   body { company: "Stripe" }  -> scan one company's board (with JDs on the shortlist)
//   body { staleDays: 3 }       -> scan watchlist companies last scraped > 3 days ago (or never)
//   body { }                    -> scan the whole watchlist (overview, no JDs)
// Mechanical only (no LLM): fetch the ATS board, filter by the company's titles/location,
// dedup against tracked applications, return the shortlist. Stamps last_scraped_at.
export async function POST(request: Request) {
  let body: { company?: string; staleDays?: number };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  try {
    if (body.company) {
      return Response.json({ result: await scanCompany(body.company) });
    }
    const staleDays = typeof body.staleDays === "number" && body.staleDays >= 0 ? body.staleDays : undefined;
    return Response.json({ results: await scanWatchlist({ staleDays }) });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
