import { addExclusions } from "@landed/backend/db/profile";
import { KEYWORD_AXES, type KeywordAxis } from "@landed/shared/jobs/dismiss";

export const dynamic = "force-dynamic";

// POST /api/profile/exclude  body: { axis, terms: string[] } -> append to that exclude axis.
//
// An APPEND endpoint rather than the generic profile POST, which takes a whole array. The caller is a
// popup that fires right after a discard, so a read-modify-write would carry a list read before the
// discard and could overwrite a term added in between. Appending server-side means the client only
// has to name what it's adding.
//
// It also keeps the era semantics in one place: adding is not a change of mind (see
// changedPreferences) — the user is codifying a rejection they already made — so this deliberately
// cannot remove anything. Removals go through the Profile page, where they open a new era.
export async function POST(request: Request) {
  let body: { axis?: string; terms?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!(KEYWORD_AXES as readonly string[]).includes(body.axis ?? ""))
    return Response.json({ error: `axis must be ${KEYWORD_AXES.join(" | ")}` }, { status: 400 });
  const terms = Array.isArray(body.terms) ? body.terms.filter((t): t is string => typeof t === "string") : [];
  if (!terms.length) return Response.json({ error: "terms is required" }, { status: 400 });

  const profile = addExclusions(body.axis as KeywordAxis, terms);
  return Response.json({ profile });
}
