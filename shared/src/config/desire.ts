// How much you WANT a company, 1–5 — a tag you set by hand on the company record.
//
// Deliberately NOT `tier`: tier is an operational grouping (tier1 = top target … tier3 = the broad
// practice pool) that discovery and the board key off, and the agent sets it by default on any
// company it adds. Desire is your own answer to "how badly do I want this one", never inferred, and
// nothing in the pipeline branches on it — it's for reading and sorting your list. Also not a
// *seniority* level: that's the role's rung (postings.level / the leveling ladder).
//
// null = untagged, which is the resting state. There is no 0 — an untagged company is not the same
// as one you've decided you don't want (tag that a 1).

export type Desire = 1 | 2 | 3 | 4 | 5;

export const DESIRE_MIN = 1;
export const DESIRE_MAX = 5;

// Best first — the order a picker or a legend should read.
export const DESIRE_VALUES: Desire[] = [5, 4, 3, 2, 1];

// `label` is the word on its own; `chip`/`text` are the Tailwind tones for the tag (warmest at 5,
// fading to zinc at 1), mirroring how TIER_META carries its own colors.
export const DESIRE_META: Record<Desire, { label: string; hint: string; chip: string; text: string }> = {
  5: { label: "Dream", hint: "Would drop everything for this one", chip: "bg-amber-500/15 ring-amber-400/30", text: "text-amber-300" },
  4: { label: "Strong", hint: "Really want it — worth a big push", chip: "bg-emerald-500/15 ring-emerald-400/30", text: "text-emerald-300" },
  3: { label: "Solid", hint: "Happy to take it", chip: "bg-sky-500/15 ring-sky-400/30", text: "text-sky-300" },
  2: { label: "Backup", hint: "Would take it if the better ones fall through", chip: "bg-zinc-500/15 ring-zinc-400/25", text: "text-zinc-300" },
  1: { label: "Practice", hint: "Mostly for the reps", chip: "bg-zinc-500/10 ring-zinc-500/20", text: "text-zinc-500" },
};

// Untyped input → a tag or nothing. A `<select>` hands back strings and the agent hands back
// whatever it hands back, so: numeric strings parse, fractions round, out-of-range CLAMPS into the
// scale (a 9 obviously means "the most"), and anything that isn't a number at all is untagged
// rather than silently becoming a 1. Booleans/arrays/objects are never numbers here, whatever
// `Number()` says about them.
export function coerceDesire(v: unknown): Desire | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(DESIRE_MAX, Math.max(DESIRE_MIN, Math.round(n))) as Desire;
}

// Sort key: untagged sorts to the bottom of a "most wanted first" sort rather than mixing in at 3.
export const desireSortVal = (d: number | null | undefined): number => d ?? 0;

// "5 · Dream" — the long form for a picker option or a tooltip.
export const desireLabel = (d: number | null | undefined): string => {
  const k = coerceDesire(d);
  return k == null ? "—" : `${k} · ${DESIRE_META[k].label}`;
};
