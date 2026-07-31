import { desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@landed/core/db";
import { postings, companies } from "@landed/core/db/schema";

export const dynamic = "force-dynamic";

// GET /api/fitlab/postings → recent postings that have a JD, for the Fit Lab "assess an existing
// posting" picker. Mechanical read only — no LLM, no mutation.
export async function GET() {
  const rows = db.select({ id: postings.id, role: postings.title, location: postings.location, company: companies.name, scannedAt: postings.scannedAt })
    .from(postings).innerJoin(companies, eq(postings.companyId, companies.id))
    .where(isNotNull(postings.jd))
    .orderBy(desc(postings.scannedAt))
    .limit(150)
    .all();
  return Response.json({ postings: rows });
}
