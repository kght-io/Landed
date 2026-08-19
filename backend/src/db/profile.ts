import { getConfig, setConfig } from "./config-store";
import { DEFAULT_LEVELING_REF, type LevelingRef } from "@landed/shared/config/leveling";

// The candidate's search identity — the source of truth for what counts as a fit. Read by the
// scan's second pass (the agent) and the fit playbook's leveling. Stored as one JSON blob in
// app_config under "profile"; editable on the Profile page.
//
// The two judgment blocks the agent honors (`fitGuidance` / `tailorGuidance`) USED to live here.
// They're versioned rows now (db/prompts.ts) so a prompt change can be attributed to the callbacks
// it earned; `agentProfile()` splices the active bodies back in under the same keys, so what
// /api/context hands the agent is unchanged. Old blobs still carry the two dead keys — inert, since
// this type no longer names them and getProfile's spread absorbs anything extra.
export type Profile = {
  levelBaseline: string; // who I am, level-wise
  levelRule: string; // how to pick the target level per company
  includeDisciplines: string[]; // SWE disciplines that count as a match
  excludeDisciplines: string[]; // disciplines to drop even if the title says "engineer"
  locations: string; // where I'll work
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

// Merge a partial patch over the current profile and persist. The patch arrives from an untyped
// HTTP body, so only keys this type still names survive — a stale caller POSTing `fitGuidance` here
// (it lived on the profile until prompt versions took over) writes nothing, instead of landing a
// key nothing reads. Persisting only known keys also retires the dead ones on the next save.
export function setProfile(patch: Partial<Profile>): Profile {
  const current = getProfile();
  const next = { ...current };
  for (const k of Object.keys(DEFAULT_PROFILE) as (keyof Profile)[]) {
    if (patch[k] !== undefined) (next[k] as Profile[keyof Profile]) = patch[k]!;
  }
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
