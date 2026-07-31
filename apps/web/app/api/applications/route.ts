import { listPostings } from "@landed/core/db/queries";

export const dynamic = "force-dynamic";

// GET /api/applications -> all postings (board shape)
export async function GET() {
  try {
    return Response.json({ postings: listPostings() });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
