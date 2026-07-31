import { getConfig, setConfig } from "./config-store";
import { DEFAULT_LEVELING_REF, type LevelingRef } from "@landed/shared/leveling";

// The candidate's search identity — the source of truth for what counts as a fit. Read by the
// scan's second pass (the agent) and the fit playbook's leveling. Stored as one JSON blob in
// app_config under "profile"; editable on the Discovery page.
export type Profile = {
  levelBaseline: string; // who I am, level-wise
  levelRule: string; // how to pick the target level per company
  includeDisciplines: string[]; // SWE disciplines that count as a match
  excludeDisciplines: string[]; // disciplines to drop even if the title says "engineer"
  locations: string; // where I'll work
  fitGuidance: string; // how the agent should assess fit (honored by fit.md)
  tailorGuidance: string; // how the agent should tailor the resume (honored by tailoring.md)
};

const PROFILE_KEY = "profile";

// Placeholder defaults — generic but functional, so a fresh install runs and assesses fit
// out of the box. EDIT THESE to your own search identity on the Discovery page (they're the
// single biggest driver of fit calls). The disciplines below are illustrative examples.
export const DEFAULT_PROFILE: Profile = {
  levelBaseline: "Senior Software Engineer, ~6 years of experience",
  levelRule:
    "Target Senior at big / rigorous-leveling companies (FAANG-scale, strict ladders); Staff at smaller companies / startups. Senior Staff+ / Principal = stretch.",
  includeDisciplines: ["backend", "fullstack", "platform", "infrastructure", "distributed systems"],
  excludeDisciplines: ["hardware / embedded", "IT / sysadmin"],
  locations: "Remote (US)",
  fitGuidance:
    "Weight leveling match and hard-gap coverage most; the score is secondary. Be honest — a weak or partial match is a 'low', not a stretch. Favor roles at or near my level and flag big level stretches. Call out any hard must-have I clearly lack.",
  tailorGuidance:
    "Mirror the JD's exact terms — but only what I can truthfully claim; never invent experience. Lead with my most relevant bullets, keep them concrete and metric-driven, and address the fit record's hard gaps honestly. Keep the resume ATS-clean: standard sections, no tables or graphics.",
};

export function getProfile(): Profile {
  const raw = getConfig(PROFILE_KEY);
  if (!raw) return DEFAULT_PROFILE;
  try {
    return { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

// Merge a partial patch over the current profile and persist.
export function setProfile(patch: Partial<Profile>): Profile {
  const next = { ...getProfile(), ...patch };
  setConfig(PROFILE_KEY, JSON.stringify(next));
  return next;
}

// The leveling reference — the anchor ladder every company is drawn against. Stored alongside the
// profile in app_config; defaults to Amazon (DEFAULT_LEVELING_REF) until the user customizes it.
const LEVELING_REF_KEY = "leveling_ref";

export function getLevelingRef(): LevelingRef {
  const raw = getConfig(LEVELING_REF_KEY);
  if (!raw) return DEFAULT_LEVELING_REF;
  try {
    return { ...DEFAULT_LEVELING_REF, ...(JSON.parse(raw) as Partial<LevelingRef>) };
  } catch {
    return DEFAULT_LEVELING_REF;
  }
}

export function setLevelingRef(patch: Partial<LevelingRef>): LevelingRef {
  const next = { ...getLevelingRef(), ...patch };
  setConfig(LEVELING_REF_KEY, JSON.stringify(next));
  return next;
}
