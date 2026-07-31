import { listScannedPostings, scannedBucketCounts } from "@landed/backend/db/queries";

export const dynamic = "force-dynamic";

// GET /api/scanned?company=&state=<funnel step>  (or ?counts=1[&q=term,term] for per-step counts)
// The watchlist-scan triage store — everything the app's ATS scan saw. `state` is the funnel step
// (review · fit_queue · assessed · apply_later · tailoring · tailored · applied · dismissed · filtered).
// `?counts=1&q=Reddit,Stripe` returns per-step counts limited to those companies (the spine's
// filtered "where is this company?" heatmap); omit `q` for the full totals.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  try {
    if (q.get("counts")) {
      const terms = (q.get("q") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      return Response.json({ counts: scannedBucketCounts(terms) });
    }
    return Response.json({
      postings: listScannedPostings({
        company: q.get("company") ?? undefined,
        state: q.get("state") ?? undefined,
      }),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
