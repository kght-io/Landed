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
  // The comp bar, in your own words ("$250k base", "$400k TC"). Free text, not a number: ranges are
  // stated a dozen ways and the fit criterion compares prose to prose. EMPTY IS FINE and is the
  // default — the comp criterion answers `na` when there's no floor to compare against, so it never
  // penalises a posting for a bar you haven't set.
  compFloor: string;
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
  compFloor: "",
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


// ── preference eras ───────────────────────────────────────────────────────────────────────────
// Preferences drift, and a label is only meaningful against the preferences in force when it was
// made. A `level` discard recorded while targeting Senior/Staff says the OPPOSITE thing once the
// target is Staff/Principal — so without a boundary, every old label silently becomes a claim about
// a preference no longer held.
//
// Versioning rather than expiry, because drift isn't uniform: "I'm a backend engineer" doesn't go
// stale on a timer, while a level target can flip in a year. An era boundary records drift WHEN IT
// HAPPENS instead of guessing it from age — and "my level preference changed on this date" is a
// fact you can read, which no decay curve gives you.
//
// Same shape as promptVersions, for the same reason: a result outlives the thing that produced it.
const PROFILE_VERSIONS_KEY = "profile_versions";

// Only the fields a LABEL depends on. A résumé path or a display tweak isn't a change of taste, and
// treating it as one would invalidate labels for nothing.
const PREFERENCE_FIELDS: (keyof Profile)[] = [
  "levelBaseline", "levelRule", "includeDisciplines", "excludeDisciplines", "locations", "compFloor",
];

export type ProfileVersion = {
  version: number; // 1-based
  effectiveFrom: string; // ISO — the era's start; labels after this belong to it
  changed: (keyof Profile)[]; // which preferences moved, so drift is legible at a glance
  profile: Profile; // the full snapshot, so an old era can still say what it believed
};

export function profileVersions(): ProfileVersion[] {
  const raw = getConfig(PROFILE_VERSIONS_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as ProfileVersion[]) : [];
  } catch {
    return [];
  }
}

export function currentProfileVersion(): ProfileVersion | null {
  return profileVersions().at(-1) ?? null;
}

// The date the current preference era began — what the eval scopes to, so it never scores today's
// filter against decisions made under a different set of preferences. A profile nobody has edited
// has no boundary, so its era is "always": the epoch, not `now`, which would exclude everything.
export function profileEraStart(): string {
  return currentProfileVersion()?.effectiveFrom ?? new Date(0).toISOString();
}

// Which preference fields actually differ. Array fields compare by content — reordering the same
// disciplines is not a change of mind.
function changedPreferences(before: Profile, after: Profile): (keyof Profile)[] {
  return PREFERENCE_FIELDS.filter((k) => {
    const a = before[k];
    const b = after[k];
    return Array.isArray(a) && Array.isArray(b)
      ? a.length !== b.length || a.some((x, i) => x !== b[i])
      : a !== b;
  });
}

function recordProfileVersion(before: Profile, after: Profile): void {
  const changed = changedPreferences(before, after);
  // Re-saving the same values is not a change of mind; manufacturing a boundary would fragment the
  // label history for nothing.
  if (!changed.length) return;
  const history = profileVersions();
  history.push({
    version: history.length + 1,
    effectiveFrom: new Date().toISOString(),
    changed,
    profile: after,
  });
  setConfig(PROFILE_VERSIONS_KEY, JSON.stringify(history));
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
  // After the write, so a version only exists for a profile that was actually stored.
  recordProfileVersion(current, next);
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
