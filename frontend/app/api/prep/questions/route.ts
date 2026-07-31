import { listQuestions, addLeetcodeStub } from "@landed/backend/db/prep";
import { createJob } from "@landed/backend/jobs/store";

export const dynamic = "force-dynamic";

// GET /api/prep/questions?track=&company=  -> questions + derived progress
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const track = searchParams.get("track") || undefined;
    const company = searchParams.get("company") || undefined;
    return Response.json({ questions: listQuestions({ track, company }) });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/prep/questions  body: { url, topic? } -> manual Leetcode add. Inserts a provisional stub
// immediately (name from the URL slug, difficulty/topic pending) and queues a `leetcode-add` the agent
// job to fill the real name/difficulty/topic. Returns { status, question }. A URL that's already in
// the bank is a no-op ({ status:"exists" }); a non-LeetCode URL 400s.
export async function POST(request: Request) {
  let body: { url?: string; topic?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const url = body.url?.trim();
  if (!url) return Response.json({ error: "url required" }, { status: 400 });

  try {
    const r = addLeetcodeStub({ url, topic: body.topic });
    if (r.status === "invalid") return Response.json({ error: "not a LeetCode problem URL" }, { status: 400 });
    if (r.status === "created") {
      createJob({ type: "leetcode-add", createdBy: "You", params: { id: r.question.id, url, topic: body.topic?.trim() || undefined } });
    }
    return Response.json({ status: r.status, question: r.question });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
