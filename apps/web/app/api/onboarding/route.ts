import { onboardingStatus } from "@landed/core/onboarding";

export const dynamic = "force-dynamic";

// GET /api/onboarding -> which first-run setup steps are done (drives the Home "Get started" card).
export async function GET() {
  try {
    return Response.json({ status: onboardingStatus() });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
