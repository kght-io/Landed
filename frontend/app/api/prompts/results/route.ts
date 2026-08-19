import { promptExperiments } from "@landed/backend/db/prompt-experiments";

export const dynamic = "force-dynamic";

// GET /api/prompts/results -> the raw experiment record: one applied posting per row, carrying the
// prompt versions that produced it and the outcome it earned. No rates — see db/prompt-experiments.
export async function GET() {
  try {
    return Response.json(promptExperiments());
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
