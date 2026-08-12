import { health } from "@landed/backend/db/health";

export const dynamic = "force-dynamic";

// GET /api/health → can this process serve traffic? The container healthcheck and any uptime probe
// point here. Thin by design: the judgement lives in @landed/backend/db/health, which is unit-tested.
//
// 503 (not 200-with-ok:false) when unhealthy — a probe that always answers 200 is a probe that can
// never fail, and Docker/Fly healthchecks read the status code, not the body.
//
// 503 is the SOFT failure: the database opened but the schema isn't all there. A database that can't
// be opened at all never reaches this handler — ../../instrumentation.ts imports the backend before
// the first request, so better-sqlite3 throws during boot and Next answers 500 (verified). Both fail
// the healthcheck, which is what matters; don't read a 503 here as the only unhealthy state.
export function GET() {
  const report = health();
  return Response.json(report, { status: report.ok ? 200 : 503 });
}
