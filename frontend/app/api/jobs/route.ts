import { listJobs, inboxLastSynced, agentContext, createJob, enqueueInboxSync, reconcileFitQueue, reconcileTailoringQueue, reapStuckJobs } from "@landed/backend/jobs/store";
import { JOB_DEFS, jobDef } from "@landed/backend/jobs/registry";

export const dynamic = "force-dynamic";

// GET /api/jobs -> job types + the DB-backed job ledger/queue + inbox watermark + context.
// The queue and results live in the `jobs` table now (the agent submits via the submitJobResult
// MCP tool), so there's nothing to scan or export here — just read the DB.
//
// Optional `?status=` (comma-separated, e.g. `queued` or `queued,wip`) filters the `jobs` array to
// those statuses — the agent's listJobs tool uses it to fetch only actionable work, not the whole
// ingested ledger. Omitted → all jobs (the app's Agents page wants the full history). Matched
// against the effective status (a stale `wip` lease already reads back as `queued` via listJobs).
export async function GET(request: Request) {
  try {
    reconcileFitQueue(); // keep the agent's queue in sync with fit_queue candidates before listing
    reconcileTailoringQueue(); // and re-queue any tailoring candidate stranded without a live job
    reapStuckJobs(); // watchdog tick: dead-letter poison jobs (claimed too many times, no result)
    const defs = Object.values(JOB_DEFS);
    const types = defs.filter((d) => !d.hidden).map((d) => ({ type: d.type, title: d.title, description: d.description, playbook: d.playbook }));
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    // `lean=1` (the agent's MCP read path) strips task/params from QUEUED rows so the queue is a
    // claim-first menu: to get a job's work content you must lease it (claimNext). The app's own UI
    // omits `lean`, so it still gets full params/task to render job subjects.
    const lean = url.searchParams.get("lean") === "1";
    const wanted = statusParam ? new Set(statusParam.split(",").map((s) => s.trim()).filter(Boolean)) : null;
    const all = wanted ? listJobs().filter((j) => wanted.has(j.status)) : listJobs();
    const jobs = lean
      ? all.map((j) => {
          if (j.status !== "queued") return j;
          const lite = { ...j }; // queued rows go out as a claim-first menu — no work content
          delete lite.task;
          delete lite.params;
          return lite;
        })
      : all;
    return Response.json({
      types,
      playbooks: defs.map((d) => d.playbook), // all (incl. hidden) — so the Guides list excludes them
      jobs,
      inboxLastSynced: inboxLastSynced(),
      context: agentContext(),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/jobs  body: { type, params?, task?, createdBy? } -> queue a job (createJob tool).
// Used by the agent to self-queue work (discovery → fit chaining, scheduled runs). The DB
// replacement for writing a queue file. Returns the new job id.
export async function POST(request: Request) {
  let body: { type?: string; params?: Record<string, unknown>; task?: string; createdBy?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.type || !jobDef(body.type))
    return Response.json({ error: `unknown or missing job type: ${body.type}` }, { status: 400 });
  try {
    // An inbox-sync needs its search window (`params.since`) or the agent has to guess it — and
    // neither client here can compute it (the watermark is server state). Fill it in unless the
    // caller named its own window. This is the seam both the Sync-inbox button and the agent's
    // createJob MCP tool come through.
    const id =
      body.type === "inbox-sync" && !body.params?.since && !body.task
        ? enqueueInboxSync({ createdBy: body.createdBy })
        : createJob({ type: body.type, params: body.params, task: body.task, createdBy: body.createdBy });
    return Response.json({ id });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
