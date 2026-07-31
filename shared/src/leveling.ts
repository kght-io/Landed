// A company's IC SWE seniority ladder, collected from levels.fyi by the agent during add-watchlist
// (see watchlist-add.md) and normalized to a shared 1–10 scale. The reference ladder it's drawn
// against — and which rung counts as the target "straddle" band — is configurable per install
// (see LevelingRef / getLevelingRef). `source: "none"` = the company has no ladder.
export type Leveling = {
  source: "levels.fyi-geometry" | "none";
  ladder?: Record<string, [number, number]>; // level name → [min, max] on the 1–10 scale
  titles?: Record<string, string>; // level name → the company's role title for that rung
  // (e.g. Amazon "L6" → "Senior Software Engineer"). Optional — older records lack it until re-scraped.
};

// Your own reference ladder — the anchor every company is drawn against in the level popover.
// Stored in app_config (key "leveling_ref"), editable on the Discovery page. Defaults to Amazon so
// existing installs are unchanged, but swap company/ladder/targetBand for any reference you like.
export type LevelingRef = {
  company: string; // anchor label shown above the reference column
  role: string; // the IC track this ladder is for, e.g. "Software Engineer"
  ladder: Record<string, [number, number]>; // reference rungs on the shared 1–10 scale (internal;
  // collected from levels.fyi, not surfaced in the config UI)
  titles?: Record<string, string>; // reference rung → its role title (e.g. "L6" → "Senior Software Engineer")
  targetBand: string; // the reference rung treated as the target — its straddle is highlighted
};

// The normalized axis bounds the scale lives on.
export const LEVEL_AXIS: [number, number] = [1, 10];

// Default reference: Amazon's IC SWE ladder on the 1–10 scale (L4 ≈ 1, L8 ≈ 9.3), target = L6
// [4.9, 7.4] (the Senior↔Staff band). Override per-install via the Leveling reference panel.
export const DEFAULT_LEVELING_REF: LevelingRef = {
  company: "Amazon",
  role: "Software Engineer",
  targetBand: "L6",
  ladder: {
    L4: [1.0, 2.7],
    L5: [2.7, 4.9],
    L6: [4.9, 7.4],
    L7: [7.4, 8.6],
    L8: [8.6, 9.3],
  },
  titles: {
    L4: "SDE I",
    L5: "SDE II",
    L6: "Senior Software Engineer",
    L7: "Principal Engineer",
    L8: "Senior Principal Engineer",
  },
};

// True when there's a renderable ladder.
export const hasLadder = (l?: Leveling | null): l is Leveling =>
  !!l && l.source !== "none" && !!l.ladder && Object.keys(l.ladder).length > 0;

// The company's rungs that intersect the reference's target band — computed at render time from the
// current LevelingRef, so changing your reference re-highlights instantly with no re-scan needed.
export function straddleRungs(ladder: Record<string, [number, number]>, ref: LevelingRef): string[] {
  const band = ref.ladder[ref.targetBand];
  if (!band) return [];
  const [lo, hi] = band;
  return Object.entries(ladder)
    .filter(([, [rlo, rhi]]) => rhi > lo && rlo < hi) // overlapping intervals
    .map(([name]) => name);
}
