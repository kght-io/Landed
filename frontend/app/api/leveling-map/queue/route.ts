import { queueMissingLadderMaps, queueLadderMap } from "@landed/backend/jobs/store";

export const dynamic = "force-dynamic";

// POST /api/leveling-map/queue
//   body { company: "Amazon" } -> research THAT company's ladder now, even if it already has a map
//                                 (ladders get renamed, and a stored mapping can simply be wrong).
//   body {}                    -> queue one job per watchlisted company whose ladder we can't read
//                                 yet, skipping anything already in flight or cooling off.
//
// This is stage 2a of the scan cascade: per COMPANY, once, cached. It never looks at a posting — a
// board can carry 90 of them and "is L6 senior here?" has one answer for all of them.
export async function POST(request: Request) {
  let body: { company?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  try {
    if (body.company) {
      const r = queueLadderMap(body.company);
      if (r.status === "not-found") return Response.json({ error: "company not tracked" }, { status: 404 });
      return Response.json(r);
    }
    return Response.json(queueMissingLadderMaps());
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
