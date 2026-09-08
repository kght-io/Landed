import { agentDashboards, agentTypesWithRuns } from "@landed/backend/db/agent-metrics";
import type { Period } from "@landed/shared/agents/run-metrics";

export const dynamic = "force-dynamic";

const PERIODS = new Set(["day", "week", "month"]);

// GET /api/agents/metrics?type=fit,tailoring&period=day&days=30
//   Run telemetry for one or more agents (comma-separated) — the bucketed trend per agent, which
//   the dashboard overlays as series on a shared axis.
//   Omit `type` to get just the list of agent types that have runs (the dashboard's picker).
//
// Every read sweeps the run journals first, so a run that finished with no browser attached is
// still recorded — that's the overnight case, and it's the one the live tailer can't catch.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  try {
    const raw = q.get("type");
    if (!raw) return Response.json({ types: agentTypesWithRuns() });

    // Deduped and capped: the categorical palette has eight fixed slots, and a ninth series would
    // have to be a generated hue — which is exactly what the palette rules forbid.
    const types = [...new Set(raw.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 8);
    const period = (PERIODS.has(q.get("period") ?? "") ? q.get("period") : "day") as Period;
    const days = Number(q.get("days"));
    return Response.json({
      agents: agentDashboards(types, period, Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
