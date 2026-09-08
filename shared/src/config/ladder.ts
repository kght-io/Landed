// A company's rung → seniority mapping: what "L6" or "MTS" actually means at THIS company.
//
// Why this exists at all. The scan's level gate was a substring match against a per-company
// `targetTitles` list the agent wrote once at add-time and never revisited, so its strictness was
// effectively random — Airbnb's `["Senior"]` dropped every Staff role, Anthropic's list dropped
// every unlevelled title, and Jane Street's empty list filtered nothing. 150 postings died there in
// four weeks, many of them good. The fix is to know the ladder instead of guessing at the words.
//
// Deliberately NOT the same thing as `config/leveling.ts`. That one holds levels.fyi's normalized
// 1–10 geometry and exists to draw the popover's comparison bars; it is cosmetic and nothing filters
// on it. This one is ordinal, cheap to collect, and is what the level gate reads.

// The vocabulary, ordered. Coarse on purpose: finer distinctions than these can't be recovered
// reliably from a job title, and a band the model can't assign consistently is worse than absent.
export const SENIORITY_BANDS = ["junior", "mid", "senior", "staff", "principal", "distinguished"] as const;
export type SeniorityBand = (typeof SENIORITY_BANDS)[number];

// One rung of the company's IC ladder.
//   `titles` — what the company actually PUTS IN A POSTING for this rung. That's the join key: the
//     scan only ever sees a title, never a rung name.
//   `bands`  — every band this rung might be. Usually one. More than one is the ambiguity being
//     preserved rather than resolved: if sources disagree whether a bare "Member of Technical Staff"
//     is senior or staff, both are recorded and the gate keeps anything that overlaps the target.
//     Widening is never a drop — that's the recall rule, and it lives here so it can't be forgotten
//     at the call site.
export type LadderRung = {
  rung: string;
  titles: string[];
  bands: SeniorityBand[];
};

export type LadderMap = {
  rungs: LadderRung[];
  // Where the belief came from. `model` = recalled only; `search` = the web contradicted the model
  // and won; `model+search` = confirmed. Recorded because reliability varies enormously — high for
  // big-tech ladders, low for startups and renamed ones — and a consumer deserves to know which.
  source: "model" | "search" | "model+search";
  // Why this mapping, in prose, naming what confirmed it. There is no ground truth behind any of
  // this, so the reasoning IS the artifact: without it a wrong mapping is indistinguishable from a
  // right one and there's nothing to correct against.
  reason: string;
  checkedAt: string; // ISO — ladders get renamed; a stale map should be visibly stale
};

export const hasLadderMap = (m?: LadderMap | null): m is LadderMap => !!m && m.rungs.length > 0;

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Which band(s) a posting title belongs to, or null when the map can't place it.
//
// Null is NOT an empty array, and the difference matters downstream: null means "this map has
// nothing to say", which the gate must treat as keep. An empty list would read as "checked, and no
// band fits" — an invitation to drop the very unlevelled titles this whole mechanism exists to
// rescue.
//
// Matching is by containment, because real postings decorate the title ("Senior Software
// Development Engineer, Sponsored Products"); an exact match would resolve almost nothing. The
// LONGEST matching title wins, so a "Senior Software Engineer" rung isn't stolen by a shorter
// "Software Engineer" entry on a lower rung.
export function bandsForTitle(title: string, map: LadderMap): SeniorityBand[] | null {
  const t = normalize(title);
  if (!t) return null;

  let best: { len: number; bands: SeniorityBand[] } | null = null;
  for (const rung of map.rungs) {
    for (const candidate of rung.titles) {
      const c = normalize(candidate);
      if (!c || !t.includes(c)) continue;
      if (!best || c.length > best.len) best = { len: c.length, bands: rung.bands };
    }
  }
  return best ? best.bands : null;
}

// --- coercion from agent output -------------------------------------------------------------
// The map arrives as `unknown` from an agent result. Leniency is the house style — a half-readable
// record beats a rejected one — but with one hard floor: a rung with no valid band, or no title to
// match on, is DROPPED rather than kept in a degraded form. A rung the gate can't use is not
// merely useless; read as a confident verdict it would drop postings on nonsense.
const isBand = (v: unknown): v is SeniorityBand =>
  typeof v === "string" && (SENIORITY_BANDS as readonly string[]).includes(v);

function coerceRung(v: unknown): LadderRung | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const rung = typeof o.rung === "string" ? o.rung.trim() : "";
  const titles = Array.isArray(o.titles)
    ? o.titles.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean)
    : [];
  const bands = Array.isArray(o.bands) ? o.bands.filter(isBand) : [];
  if (!rung || titles.length === 0 || bands.length === 0) return null;
  // De-dupe while preserving the ladder's own order, so `bands` reads low→high as written.
  const seen = new Set<SeniorityBand>();
  const ordered = SENIORITY_BANDS.filter((b) => bands.includes(b) && !seen.has(b) && (seen.add(b), true));
  return { rung, titles, bands: ordered };
}

export function coerceLadderMap(v: unknown): LadderMap | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const rungs = Array.isArray(o.rungs) ? o.rungs.map(coerceRung).filter((r): r is LadderRung => !!r) : [];
  const reason = typeof o.reason === "string" ? o.reason.trim() : "";
  // No rungs = nothing to map. No reason = nothing to audit, and since there's no ground truth here,
  // an unexplained mapping can never be checked or corrected — so it isn't worth storing.
  if (rungs.length === 0 || !reason) return null;
  const source = o.source === "search" || o.source === "model+search" ? o.source : "model";
  const checkedAt = typeof o.checkedAt === "string" && o.checkedAt ? o.checkedAt : new Date().toISOString();
  return { rungs, source, reason, checkedAt };
}
