import { storageUsage } from "@landed/backend/db/ops";
import { scanFunnel, filterPrecision, fitAgreement, callbackByFitScore, currentEvalSince } from "@landed/backend/db/pipeline-metrics";
import { currentProfileVersion } from "@landed/backend/db/profile";

export const dynamic = "force-dynamic";

// GET /api/ops → is the PIPELINE working, and what is it costing on disk?
//
// Deliberately not "is the machine alive" any more. Queue depth, in-flight counts, failed jobs and
// the agent-health table all moved to Agents › Dashboard, where the per-agent telemetry already
// lives — and liveness is something you notice anyway on a single-user local app. What you can't
// notice is quality: whether each stage's judgement matches yours.
//
// Every rate carries its denominator, and a rate below the decision floor comes back null rather
// than as a number — 57% of 35 decisions is a very different claim from 57% of 3,500.
export async function GET() {
  try {
    const era = currentProfileVersion();
    return Response.json({
      funnel: scanFunnel(),
      quality: {
        // Scoped to the current preference era: a decision made under different preferences says
        // nothing about today's filter.
        since: currentEvalSince(),
        era: era ? { version: era.version, effectiveFrom: era.effectiveFrom, changed: era.changed } : null,
        scan: filterPrecision(),
        fit: fitAgreement(),
        callback: callbackByFitScore(),
      },
      storage: storageUsage(),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
