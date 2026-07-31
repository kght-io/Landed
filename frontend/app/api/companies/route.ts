import { listCompanies, upsertCompanies, toCompanyView, type CompanyInput } from "@landed/backend/db/queries";

export const dynamic = "force-dynamic";

// GET /api/companies -> every company you track (the full universe), each with tier, the
// `watchlist` flag, and scrape config (ats, slug, endpoint, careersUrl, titles, location).
// The visibility read: a freshly-upserted company shows here even before it's watchlisted or
// has any postings. For just the discovery scan subset, use GET /api/watchlist.
export async function GET() {
  try {
    return Response.json({ companies: listCompanies() });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/companies  body: { companies: CompanyInput[] } -> upsert company records
// (tier + scrape config). Matched by canonical name; only provided fields change. Does NOT
// touch the watchlist — manage that via /api/watchlist. Returns the upserted rows + counts.
export async function POST(request: Request) {
  let body: { companies?: CompanyInput[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!Array.isArray(body.companies) || body.companies.length === 0)
    return Response.json({ error: "companies must be a non-empty array" }, { status: 400 });
  if (body.companies.some((c) => !c?.name || typeof c.name !== "string"))
    return Response.json({ error: "every company needs a name" }, { status: 400 });

  try {
    const { upserted, inserted, updated } = upsertCompanies(body.companies, { actor: "CoWork", source: "mcp" });
    return Response.json({ inserted, updated, companies: upserted.map(toCompanyView) });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
