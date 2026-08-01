import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { postings, agentRuns } from "./db/schema";
import { getConfig } from "./db/config-store";
import { PATHS, ASSET_ROOT } from "./config";
import { gmailCredentials } from "./gmail";
import type { OnboardingStatus } from "@landed/shared/onboarding";

export { onboardingComplete, onboardingAllDone, ONBOARDING_ESSENTIALS, type OnboardingStatus } from "@landed/shared/onboarding";

// First-run setup state, driving the Home "Get started" checklist. Each flag is derived from real
// data so a step ticks the moment it's actually done (no separate progress bookkeeping to drift).
// Server-only (reads the DB + filesystem + Gmail creds); the client imports the type/helpers from
// @landed/shared/onboarding instead.
export function onboardingStatus(): OnboardingStatus {
  const count = (table: typeof postings | typeof agentRuns): number =>
    db.select({ n: sql<number>`count(*)` }).from(table).get()?.n ?? 0;
  return {
    profile: getConfig("profile") != null,
    assetFolder: existsSync(ASSET_ROOT),
    resume: existsSync(PATHS.baseResume("docx")),
    firstJob: count(postings) > 0,
    gmail: !!gmailCredentials(),
    agent: count(agentRuns) > 0,
  };
}
