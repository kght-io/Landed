import { queueStaleWatchlistScans, queueWatchlistScan } from "@landed/core/jobs/store";

export const dynamic = "force-dynamic";

// POST /api/scan/queue
//   body { company: "Stripe" } -> queue a scan for that ONE watchlisted company (the per-row
//                                 "Scan now" button), ignoring staleness.
//   body { staleDays?: number } -> queue a `watchlist-scan` job per watchlisted company not scraped
//                                 in the last `staleDays` (default 3, or never), skipping any already
//                                 in the queue (the "Scrape watchlist" button).
// Either way the scan runs through the agent queue (claim → scanCompany + glance → close), not as an
// inline app scan.
export async function POST(request: Request) {
  let body: { staleDays?: number; company?: string };
  try { body = await request.json(); } catch { body = {}; }
  try {
    if (body.company) {
      const r = queueWatchlistScan(body.company);
      if (r.status === "not-found") return Response.json({ error: "company not watchlisted" }, { status: 404 });
      return Response.json(r);
    }
    const staleDays = typeof body.staleDays === "number" && body.staleDays >= 0 ? body.staleDays : 3;
    return Response.json(queueStaleWatchlistScans(staleDays));
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
