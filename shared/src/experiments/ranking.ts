// Scoring the scan ranker: given a company's board in the order the ranker put it, how close to the
// top did the postings you actually pursued land? Pure functions over one board — no DB, no clock,
// no network — for the same reason experiments/prompts.ts is pure: the arithmetic is the part that's
// settled, so it should be directly testable without a live agent or a live database.
//
// Why ranking metrics and not precision/recall: stage 2 both filters (the level gate) and orders
// (the rank). Precision/recall answer the filter's question. They say nothing about whether the one
// posting you'd have picked was 2nd or 40th, which is the whole point of ordering a 90-posting board.
//
// The labels come from what you DID — applied, interviewed, tailored — not from any filter's own
// verdict. That is what stops the eval from grading a filter against itself.

// One company's board as the ranker emitted it, plus the postings the human actually pursued.
// `ranked` is posting ids (or any stable key) best-first; `positives` is the subset worth surfacing.
export type RankedBoard = {
  company: string;
  ranked: string[];
  positives: Set<string>;
};

// 1-based position of the first pursued posting, or null when the ranking contains none of them.
// Null is NOT zero: a board whose positive never appears was cut upstream — by the mechanical
// filter or the level gate — and scoring it as an infinitely bad rank would charge the ranker for
// somebody else's miss. The count of these exclusions is reported separately so a filter that
// quietly eats the good rows can't hide behind a healthy-looking ranking score.
function firstHit(b: RankedBoard): number | null {
  const i = b.ranked.findIndex((id) => b.positives.has(id));
  return i === -1 ? null : i + 1;
}

// Did a pursued posting make the top k? 1 or 0 per board — not a fraction of k. The question this
// answers is "would looking at the first k have been enough", which is exactly how the grouped view
// gets used: you open a company, read a few, and move on.
//
// **A board with k or fewer postings scores null, not 1.** The top k is then the whole board, so
// every ranking of it — including a deliberately terrible one — gets full marks. This is not a
// rounding detail: 90 of 132 real boards hold exactly one posting, and counting them made the
// UNRANKED baseline read 0.84 precision@1. A metric that starts at 0.84 has no room left to show an
// improvement, and most of what it was measuring was "this company had one job".
export function precisionAtK(b: RankedBoard, k: number): number | null {
  if (b.ranked.length <= k) return null; // nothing for a ranking to get wrong
  const hit = firstHit(b);
  return hit === null ? null : hit <= k ? 1 : 0;
}

// 1/position of the first pursued posting — rewards putting it 2nd over 20th, which precision@k
// can't see once both are inside the window. A single-posting board is excluded for the same reason
// as above: its only possible rank is 1.
export function reciprocalRank(b: RankedBoard): number | null {
  if (b.ranked.length <= 1) return null;
  const hit = firstHit(b);
  return hit === null ? null : 1 / hit;
}

export type RankReport = {
  boards: number; // boards big enough for a ranking to matter (> 1 posting) with a positive present
  excluded: number; // boards skipped: too small to discriminate, or no positive in the ranking
  /** Per k: the mean, and how many boards were large enough to contribute to it. */
  precisionAt: Record<number, number | null>;
  scoredAt: Record<number, number>;
  mrr: number | null;
};

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Average across boards, skipping the unscorable ones. Every rate here is per BOARD, not per
// posting: one company with 90 postings must not outvote nine companies with five, or the score
// becomes a report on Anthropic.
//
// The scorable set differs PER k — a 5-posting board informs @1 and @3 but not @10 — so each k
// carries its own board count. Reading @10 off a handful of big boards as if it were the same
// population as @1 is how a metric quietly stops meaning anything.
export function scoreBoards(boards: RankedBoard[], ks: number[] = [1, 3, 10]): RankReport {
  const precisionAt: Record<number, number | null> = {};
  const scoredAt: Record<number, number> = {};
  for (const k of ks) {
    const vals = boards.map((b) => precisionAtK(b, k)).filter((v): v is number => v !== null);
    precisionAt[k] = mean(vals);
    scoredAt[k] = vals.length;
  }
  const rrs = boards.map((b) => reciprocalRank(b)).filter((v): v is number => v !== null);
  return {
    boards: rrs.length,
    excluded: boards.length - rrs.length,
    precisionAt,
    scoredAt,
    mrr: mean(rrs),
  };
}

// Deterministic dev/test split, BY COMPANY. Splitting by posting would scatter one company's board
// across both sides — and those rows are near-duplicates of each other, so the held-out set would be
// answering questions it had already seen. Deterministic because a split that reshuffles per run
// makes two runs incomparable, which defeats the point of holding anything back.
//
// The hash is a plain FNV-1a over the company name: no seed to remember, no ordering dependence, and
// adding a company never re-partitions the ones already assigned.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function splitByCompany<T extends { company: string }>(boards: T[], devFraction = 0.7): { dev: T[]; test: T[] } {
  const cutoff = devFraction * 0xffffffff;
  const dev = boards.filter((b) => hash(b.company) < cutoff);
  const test = boards.filter((b) => hash(b.company) >= cutoff);
  // With few companies the hash can land everything on one side, which reads as a passing run over a
  // set that was never held out. Force a split rather than silently reporting a self-graded number.
  if (boards.length > 1 && (dev.length === 0 || test.length === 0)) {
    const sorted = [...boards].sort((a, b) => hash(a.company) - hash(b.company));
    const n = Math.max(1, Math.min(sorted.length - 1, Math.round(sorted.length * devFraction)));
    return { dev: sorted.slice(0, n), test: sorted.slice(n) };
  }
  return { dev, test };
}
