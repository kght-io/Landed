// Client-safe onboarding shapes + helpers — NO server imports (fs/db/gmail), so both the client
// checklist and the server status reader (lib/onboarding.ts) can use them.

// Dispatched on `window` (by the empty-table "Get started" button) to re-open the checklist card
// after it's been dismissed. The card listens for it; progress is always read live, so nothing else
// needs to be passed.
export const OPEN_GETSTARTED_EVENT = "landed:open-getstarted";
export type OnboardingStatus = {
  profile: boolean; // the search profile has been saved at least once (else it's the shipped default)
  assetFolder: boolean; // the shared asset folder (ASSET_ROOT — résumés + tailor queue) exists
  resume: boolean; // a base résumé .docx has been uploaded
  firstJob: boolean; // at least one posting exists (pasted a JD, scanned, or synced)
  gmail: boolean; // Gmail is wired (stored app password or env)
  agent: boolean; // the agent has run at least once
};

// The essentials — "is the app set up to work". (Optional power-ups: gmail, agent.)
export const ONBOARDING_ESSENTIALS = ["profile", "assetFolder", "resume", "firstJob"] as const;

export const onboardingComplete = (s: OnboardingStatus): boolean =>
  ONBOARDING_ESSENTIALS.every((k) => s[k]);

// Every step done — the checklist stays visible until this is true (or the user dismisses it).
export const onboardingAllDone = (s: OnboardingStatus): boolean =>
  (Object.keys(s) as (keyof OnboardingStatus)[]).every((k) => s[k]);
