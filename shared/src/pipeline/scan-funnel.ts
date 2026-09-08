// The Scan-results view's two jobs: group a company's postings so you can take the top one and move
// on, and say where postings died on the way here.
//
// Pure — no DB, no clock. Both the view and any scorer read the same rules, so "what the screen
// shows" and "what the funnel counts" can't drift apart.

// ── grouping ──────────────────────────────────────────────────────────────────────────────────
// The redesign this serves: before, every row in this tab was a to-do you cleared by hand, and
// clearing 90 Anthropic postings one at a time is what produced 203 dismissals. Grouped and ranked,
// you open a company, take the top one or two, and collapse it. The rest are not debt.
// `glanceRank` is optional as well as nullable: an API shape that simply omits the field and one
// that sends null both mean "never ranked", and requiring the key would stop callers binding.
export type GroupableRow = { company: string; title: string; glanceRank?: number | null; scannedAt: string };

export type CompanyGroup<T extends GroupableRow> = {
  company: string;
  rows: T[]; // best-first
  count: number;
  top: string; // the title to show on the collapsed header
  scannedAt: string; // the group's most recent scan, for ordering the groups
};

// Best-first within a company: ranked rows ascending, then everything unranked, newest scan first.
//
// Unranked is NOT "ranked last" — it means the ranker never saw this row (it predates 2c, or the
// agent omitted a number). Sorting them into a block after the ranked ones keeps them visible
// without implying they lost a comparison they were never in.
function byRank<T extends GroupableRow>(a: T, b: T): number {
  const ar = a.glanceRank ?? null;
  const br = b.glanceRank ?? null;
  if (ar !== null && br !== null) return ar - br;
  if (ar !== null) return -1;
  if (br !== null) return 1;
  return b.scannedAt.localeCompare(a.scannedAt);
}

export function groupByCompany<T extends GroupableRow>(rows: T[]): CompanyGroup<T>[] {
  const byCompany = new Map<string, T[]>();
  for (const r of rows) {
    const list = byCompany.get(r.company);
    if (list) list.push(r);
    else byCompany.set(r.company, [r]);
  }

  const groups: CompanyGroup<T>[] = [];
  for (const [company, list] of byCompany) {
    const sorted = [...list].sort(byRank);
    groups.push({
      company,
      rows: sorted,
      count: sorted.length,
      top: sorted[0]?.title ?? "",
      // Groups keep the flat list's own ordering rule — most recently scanned first — so the tab
      // doesn't silently reshuffle for someone used to it. There is no cross-company ranking signal
      // (2c ranks WITHIN a board), and inventing one here would be a number with nothing behind it.
      scannedAt: sorted.reduce((max, r) => (r.scannedAt > max ? r.scannedAt : max), ""),
    });
  }
  return groups.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
}

// ── the funnel ────────────────────────────────────────────────────────────────────────────────
// Where postings died. Ordered by pipeline position.
export const FUNNEL_STAGES = ["mechanical", "glance", "you", "fit", "applied"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

// Which stage made a given drop. `postings.reason` already records WHICH gate dropped a row and
// every reason belongs to exactly one stage, so attribution needs no new column.
//
// `level` and `unmatched` are RETIRED — stage 1 no longer produces them — but rows carrying them are
// still in the table from before that change, and they have to keep attributing or the funnel
// silently under-reports its own history. Retiring a reason is not the same as deleting the rows
// that carry it.
const REASON_STAGE: Record<string, FunnelStage> = {
  excluded: "mechanical",
  location: "mechanical",
  dedup: "mechanical",
  cooldown: "mechanical",
  level: "mechanical", // retired (moved to 2b) — historical rows only
  unmatched: "mechanical", // retired (moved to 2c as a ranking signal) — historical rows only
};

// Null for anything unrecognized: an agent-written glance `reason` is free prose, and guessing a
// stage for it would quietly inflate whichever bucket got the benefit of the doubt.
export function funnelStageOf(reason: string | null | undefined): FunnelStage | null {
  return reason ? REASON_STAGE[reason] ?? null : null;
}
