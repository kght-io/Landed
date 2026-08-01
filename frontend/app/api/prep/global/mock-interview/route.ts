import { saveMockSession, listMockSessions, type MockGap } from "@landed/backend/prep/mock-interviews";

export const dynamic = "force-dynamic";

// Coerce untyped JSON gaps into MockGap[] — keep only rows with a real area + detail (agent input is
// unknown; don't trust its shape). See shared/src/util/coerce.ts for the NaN/empty-string discipline.
function coerceGaps(raw: unknown): MockGap[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const gaps = raw
    .map((g) => (g && typeof g === "object" ? (g as Record<string, unknown>) : {}))
    .filter((g) => typeof g.area === "string" && typeof g.detail === "string" && g.area.trim() && g.detail.trim())
    .map((g) => ({
      area: (g.area as string).trim(),
      detail: (g.detail as string).trim(),
      severity: typeof g.severity === "string" && g.severity.trim() ? g.severity.trim() : undefined,
    }));
  return gaps.length ? gaps : undefined;
}

// GET /api/prep/global/mock-interview — list the mock-interview sessions captured so far (for status).
export async function GET() {
  return Response.json({ sessions: listMockSessions() });
}

// POST /api/prep/global/mock-interview — capture one mock-interview practice session into
// interview-prep/GLOBAL/mock-interviews/ as a fresh numbered file. Body: { notes, gaps?, title? }.
// Capture only — the readiness chat reconciles these into the GLOBAL gap ledger.
export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    notes?: unknown;
    gaps?: unknown;
    title?: unknown;
  };
  const notes = typeof payload.notes === "string" ? payload.notes : "";
  if (!notes.trim()) return Response.json({ error: "empty notes" }, { status: 400 });
  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title : undefined;
  const gaps = coerceGaps(payload.gaps);
  const file = saveMockSession({ notes, gaps, title });
  return Response.json({ file, sessions: listMockSessions() });
}
