import { listWatchlist, setWatchlist } from "@landed/backend/db/queries";

export const dynamic = "force-dynamic";

// The discovery watchlist (the scan list) — a curated subset of companies, separate from
// company curation. Scanning is expensive, so discovery only scans what's here.

// GET /api/watchlist -> the companies the agent's discovery auto-scans (with scrape config).
export async function GET() {
  try {
    return Response.json({ watchlist: listWatchlist() });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/watchlist  body: { company: string } -> add a company to the watchlist.
// Creates a minimal company record if it isn't tracked yet (so "watch X" works up front).
export async function POST(request: Request) {
  let body: { company?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.company || typeof body.company !== "string")
    return Response.json({ error: "company required" }, { status: 400 });
  const company = setWatchlist(body.company, true, { actor: "CoWork", source: "mcp" });
  return company
    ? Response.json({ company })
    : Response.json({ error: "could not resolve company name" }, { status: 400 });
}

// DELETE /api/watchlist?company=Acme -> remove a company from the watchlist (no-op if absent).
export async function DELETE(request: Request) {
  const company = new URL(request.url).searchParams.get("company");
  if (!company) return Response.json({ error: "company required" }, { status: 400 });
  setWatchlist(company, false, { actor: "CoWork", source: "mcp" });
  return Response.json({ ok: true });
}
