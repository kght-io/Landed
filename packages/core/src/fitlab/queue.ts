import { eq } from "drizzle-orm";
import { db } from "../db";
import { postings, companies } from "../db/schema";
import { createJob } from "../jobs/store";
import { createPendingRun, listCriteria, getProfile } from "./store";
import { buildFitTask } from "@landed/shared/fitlab/task";

// Queue a fit assessment as an agent (Claude Code) job — the cost-saving route, NO direct LLM API.
// Creates the pending run row, then a `fitlab-assess` job whose task embeds the rubric + profile + JD.
// The agent claims it, reasons through Extract+Detect, and submits verdicts → ingestFitLabResult fills the run.
// This is the ONLY Fit Lab module that imports lib/jobs/store (keeps the registry's ingest cycle-free).
export function queueRun(input: { postingId?: number; company?: string; role?: string; jd?: string }): { runId: number; jobId: string } {
  let resolved: { postingId: number | null; company: string; role: string; jd: string };
  if (input.postingId) {
    const row = db.select({ p: postings, co: companies })
      .from(postings).innerJoin(companies, eq(postings.companyId, companies.id))
      .where(eq(postings.id, input.postingId)).get();
    if (!row) throw new Error("posting not found");
    if (!row.p.jd) throw new Error("posting has no JD to assess");
    resolved = { postingId: row.p.id, company: row.co.name, role: row.p.title, jd: row.p.jd };
  } else {
    const jd = (input.jd ?? "").trim();
    if (jd.length < 50) throw new Error("paste a job description (50+ chars)");
    resolved = { postingId: null, company: (input.company ?? "Pasted").trim() || "Pasted", role: (input.role ?? "Role").trim() || "Role", jd };
  }

  const runId = createPendingRun(resolved);
  const rubric = listCriteria().filter((c) => c.active).map((c) => ({ key: c.key, label: c.label, type: c.type, definition: c.definition }));
  const profile = getProfile();
  const task = buildFitTask({ runId, company: resolved.company, role: resolved.role, jd: resolved.jd, profile, rubric });
  const jobId = createJob({
    id: `fitlab-assess-${runId}`, type: "fitlab-assess", createdBy: "You",
    task, params: { runId, company: resolved.company, role: resolved.role },
  });
  return { runId, jobId };
}
