import { updateInterviewStatus } from "@landed/backend/jobs/store";

export const dynamic = "force-dynamic";

// POST /api/interview-status-update — the pipeline's one-click "Update interview status" button.
// Fans out across every actively-interviewing company: queues a global inbox-sync, refreshes each
// company's on-disk context.md, (re)pulls interview emails, and queues prep-research where it's never
// been done. Returns the counts for UI feedback.
export async function POST() {
  return Response.json(updateInterviewStatus());
}
