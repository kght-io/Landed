import { getConfig, setConfig } from "./config-store";
import { DEFAULT_LEVELING_REF, type LevelingRef } from "@landed/shared/config/leveling";
import { DEFAULT_ALLOW_LOCATION_TERMS, DEFAULT_EXCLUDE_LOCATION_TERMS, DEFAULT_EXCLUDE_TITLE_TERMS } from "@landed/shared/config/scan-filter";
import { axisForTerm } from "@landed/shared/jobs/exclude-suggest";
import { EXCLUDE_FIELD, type KeywordAxis } from "@landed/shared/jobs/dismiss";

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
  // The exclusions, one list per axis — the same three axes the discard labels use
  // (@landed/shared/jobs/dismiss). They were ONE list, `excludeDisciplines`, and one list can't
  // answer the question the labels ask: "data engineer" is the wrong JOB and "crypto" is the wrong
  // PROBLEM, and a filter reading them from the same bag asserts both at once. Splitting them is
  // what lets a `stack` discard write to the stack axis and nothing else.
  excludeRoles: string[]; // a different job — SRE, ML/research, data eng, IT
  excludeStacks: string[]; // the same job, wrong technology — iOS, frontend, C++
  excludeDomains: string[]; // the same job and stack, a problem space I don't want — ads, crypto
  locations: string; // where I'll work
  // ── stage 1: the deterministic scan filter ──
  // Unlike the three exclude axes above (guidance the agent READS), these are matched mechanically
  // and DROP a posting before any agent sees it. They were regexes in code; they're preferences, so
  // they live here. Grammar: whole words, hyphen ≡ space, trailing `*` = stem (shared/src/jobs/exclude.ts).
  excludeTitleTerms: string[]; // clearly-not-an-IC-engineer title terms — sales, manager, intern
  excludeLocationTerms: string[]; // locales out of range even when a posting says "remote"
  allowLocationTerms: string[]; // re-admits a posting that names an excluded locale too ("US/Canada")
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
  excludeRoles: ["hardware / embedded", "IT / sysadmin"],
  excludeStacks: [],
  excludeDomains: [],
  locations: "Remote (US)",
  // Stage-1 install defaults — see shared/src/config/scan-filter.ts. Copied so a profile's list is
  // its own array, never an alias of the shared constant.
  excludeTitleTerms: [...DEFAULT_EXCLUDE_TITLE_TERMS],
  excludeLocationTerms: [...DEFAULT_EXCLUDE_LOCATION_TERMS],
  allowLocationTerms: [...DEFAULT_ALLOW_LOCATION_TERMS],
  compFloor: "",
};

export function getProfile(): Profile {
  const raw = getConfig(PROFILE_KEY);
  if (!raw) return DEFAULT_PROFILE;
  try {
    const stored = JSON.parse(raw) as Partial<Profile> & { excludeDisciplines?: unknown };
    return { ...DEFAULT_PROFILE, ...expandLegacyLocationAliases(splitLegacyExcludes(stored)) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

// One-time migration off the scan's location alias table, applied on READ like splitLegacyExcludes.
//
// The scan used to widen "New York" to also match `nyc`/`ny`, and "Remote" to match `anywhere`,
// through a map in code — 15 live postings were in range only because of it. The map is gone
// (nothing in the filter is hardcoded), so a profile saved before that writes those spellings into
// its own `locations`, where they're visible and removable.
//
// Guarded on `excludeTitleTerms` being absent: any save after stage 1 moved to the profile persists
// that key, so a blob carrying it was written under the new rules and is never re-expanded — which
// is what keeps a spelling you delete deleted.
const LEGACY_LOCATION_ALIASES: Record<string, string[]> = {
  "new york": ["NYC", "NY"],
  nyc: ["New York", "NY"],
  remote: ["Anywhere"],
};
function expandLegacyLocationAliases(p: Partial<Profile>): Partial<Profile> {
  if (p.excludeTitleTerms !== undefined || typeof p.locations !== "string") return p;
  const tokens = p.locations.split(/[|,]/).map((t) => t.trim()).filter(Boolean);
  const have = new Set(tokens.map((t) => t.toLowerCase()));
  const added: string[] = [];
  for (const t of tokens) {
    for (const alias of LEGACY_LOCATION_ALIASES[t.toLowerCase()] ?? []) {
      if (!have.has(alias.toLowerCase())) { have.add(alias.toLowerCase()); added.push(alias); }
    }
  }
  return added.length ? { ...p, locations: [...tokens, ...added].join(", ") } : p;
}

// One-time migration off the single `excludeDisciplines` list, applied on READ.
//
// A read-path migration rather than a schema step because the profile is one JSON blob in app_config
// — there is no ALTER to hang it off, and a blob written before this change is still perfectly valid
// JSON. It runs until the next save persists the split (setProfile writes only keys `Profile` names,
// so the legacy key retires itself).
//
// Guarded on "none of the three axes present yet", and that guard is the whole correctness argument:
// without it, deleting a migrated term would resurrect it from the legacy key on the very next read.
// Once any axis exists — including as an empty array — the legacy list is dead and never consulted.
function splitLegacyExcludes(
  stored: Partial<Profile> & { excludeDisciplines?: unknown },
): Partial<Profile> {
  const { excludeDisciplines, ...rest } = stored;
  const migrated = rest.excludeRoles !== undefined || rest.excludeStacks !== undefined || rest.excludeDomains !== undefined;
  if (migrated || !Array.isArray(excludeDisciplines)) return rest;

  const split: Record<KeywordAxis, string[]> = { role: [], stack: [], domain: [] };
  // Every term lands on exactly one axis — see axisForTerm, which files an unrecognised one under
  // `role` rather than dropping it. Losing a term here would silently loosen the filter.
  for (const term of excludeDisciplines) {
    if (typeof term === "string" && term.trim()) split[axisForTerm(term)].push(term);
  }
  return { ...rest, excludeRoles: split.role, excludeStacks: split.stack, excludeDomains: split.domain };
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
  "levelBaseline", "levelRule", "includeDisciplines",
  "excludeRoles", "excludeStacks", "excludeDomains",
  "locations", "excludeTitleTerms", "excludeLocationTerms", "allowLocationTerms", "compFloor",
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

// A list preference read as a SET: reordering the same terms is not a change of mind, and never was.
const grew = (before: string[], after: string[]) => after.some((t) => !before.includes(t));
const shrank = (before: string[], after: string[]) => before.some((t) => !after.includes(t));

// Whether a list edit WIDENS what the filter accepts. That direction is what decides whether an era
// opens, so it has to be read per field rather than assumed:
//
//   an exclude list  — removing a term widens (a posting it used to reject now gets through)
//   an include list  — adding a term widens (a discipline that wasn't a match now is)
//
// Both list kinds are here explicitly. Defaulting would silently mis-classify the next list
// preference someone adds, and mis-classifying costs the eval its whole decision history.
const WIDENS_WHEN: Partial<Record<keyof Profile, (before: string[], after: string[]) => boolean>> = {
  includeDisciplines: grew,
  excludeRoles: shrank,
  excludeStacks: shrank,
  excludeDomains: shrank,
  excludeTitleTerms: shrank,
  excludeLocationTerms: shrank,
  allowLocationTerms: grew, // an allow list is an include list: adding re-admits postings
};

// Which preference fields changed in a way that invalidates existing labels.
//
// NOT simply "which fields differ". An era boundary scopes the eval window (see currentEvalSince), so
// opening one discards the decision history before it — and only a change that WIDENS the filter
// actually invalidates that history. A label saying "I rejected this for its domain" still describes
// a filter that excludes that domain and one more besides; it stops describing a filter that has
// started keeping the domain again.
//
// This is what makes the one-click exclusion from a discard safe. Adding a term is the label being
// ACTED ON, not overruled — the user codified a rejection they'd already made under the preferences
// in force. If every add opened an era, filter precision would never reach its 10-decision floor.
//
// A free-text preference has no direction to read, so any change to it is a change of mind.
function changedPreferences(before: Profile, after: Profile): (keyof Profile)[] {
  return PREFERENCE_FIELDS.filter((k) => {
    const a = before[k];
    const b = after[k];
    if (!Array.isArray(a) || !Array.isArray(b)) return a !== b;
    const widens = WIDENS_WHEN[k];
    if (!widens) return grew(a, b) || shrank(a, b); // unclassified list: any change counts
    return widens(a, b);
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

// Append terms to one exclude axis, de-duplicated case-insensitively so a chip clicked twice — or a
// term the user already typed by hand in a different case — doesn't become two rules the agent reads
// as two separate preferences.
//
// Additive by construction: this is the path a one-click exclusion from a discard takes, and that
// click is the user acting on a label rather than changing their mind, so it must not be able to
// remove anything (which would open a preference era and reset the eval window). Removal is a Profile
// page edit.
export function addExclusions(axis: KeywordAxis, terms: string[]): Profile {
  const field = EXCLUDE_FIELD[axis];
  const current = getProfile()[field];
  const next = [...current];
  for (const t of terms) {
    const term = t.trim();
    if (term && !next.some((x) => x.toLowerCase() === term.toLowerCase())) next.push(term);
  }
  return next.length === current.length ? getProfile() : setProfile({ [field]: next });
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
