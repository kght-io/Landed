import PromptExperiments from "@/components/PromptExperiments";

export const dynamic = "force-dynamic";

// Callback attribution for the versioned judgment prompts. A sub-route of /dashboard so the Stats
// nav item stays lit (NavRail matches with startsWith) — this is an occasional analysis surface,
// not a ninth thing to keep in the rail.
export default function PromptsDashboardPage() {
  return <PromptExperiments />;
}
