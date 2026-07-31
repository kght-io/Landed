import { recordStep } from "@landed/backend/threads";

export const dynamic = "force-dynamic";

// POST /api/threads/step — the MCP server fires this (fire-and-forget) after every tool call, so the
// app gets a live, per-chat trace of what the agent is doing. Body: { threadId, tool, jobId?, ok?,
// durationMs?, summary? }. Also bumps the thread heartbeat (lastSeenAt). Always 200 so a telemetry
// failure never surfaces to the agent.
export async function POST(request: Request) {
  try {
    const b = await request.json();
    if (b?.threadId && b?.tool) {
      recordStep({
        threadId: String(b.threadId),
        tool: String(b.tool),
        jobId: b.jobId != null ? String(b.jobId) : null,
        ok: b.ok !== false,
        durationMs: Number.isFinite(b.durationMs) ? Number(b.durationMs) : null,
        summary: b.summary != null ? String(b.summary) : null,
      });
    }
  } catch {
    // best-effort telemetry — swallow
  }
  return Response.json({ ok: true });
}
