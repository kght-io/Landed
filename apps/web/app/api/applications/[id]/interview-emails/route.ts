import { enqueueInterviewEmails } from "@landed/core/jobs/store";

export const dynamic = "force-dynamic";

// POST /api/applications/:id/interview-emails — (re)queue the "pull interview emails" job for this
// posting's company. The agent sweeps the company's last ~3 months of interviewing emails into
// interview-prep/<slug>/ (emails.md + attachments/). Asset capture only; global inbox-sync still
// owns tracker status. Idempotent on interview-emails-<companyId>. Returns { jobId, slug } (or 404).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = Number(id);
  if (!Number.isInteger(appId)) return Response.json({ error: "bad id" }, { status: 400 });
  const result = enqueueInterviewEmails(appId);
  return result ? Response.json(result) : Response.json({ error: "not found" }, { status: 404 });
}
