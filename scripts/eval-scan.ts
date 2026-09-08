// Score the scan ranker against what you actually pursued. Run: npm run eval:scan
//
// Deliberately NOT part of `npm run check`. That gate is deterministic and fast; this reads the live
// database and (once stage 2 lands) will call an agent, so it is neither. A flaky, slow step inside
// the gate teaches you to ignore the gate.
//
// Today this reports the BASELINE: the candidate list in its natural order, before any ranker
// touches it. That number is the thing stage 2c has to beat — without it, a ranker that "looks
// good" has nothing to be good compared to.
import { evalBoards } from "@landed/backend/db/scan-eval";
import { filterPrecision, currentEvalSince } from "@landed/backend/db/pipeline-metrics";
import { currentProfileVersion } from "@landed/backend/db/profile";
import { scoreBoards, splitByCompany, type RankReport } from "@landed/shared/experiments/ranking";

const KS = [1, 3, 10];
// Below this the ranked score says more about how few boards carry ranks than about the ranking.
// Same instinct as MIN_DECIDED_FOR_RATE in experiments/prompts.ts: a rate over a handful is noise
// wearing a number.
const MIN_RANKED_BOARDS = 10;

const pct = (v: number | null) => (v === null ? " n/a" : v.toFixed(2).padStart(4));

// Each k prints its own board count, because each k has its own population: a 5-posting board can
// inform @1 and @3 but not @10. A bare "0.71" over an unstated handful of boards is how a metric
// stops meaning anything.
function line(label: string, r: RankReport): string {
  const ps = KS.map((k) => `@${k} ${pct(r.precisionAt[k])} (${String(r.scoredAt[k]).padStart(2)})`).join("  ");
  return `  ${label.padEnd(5)} ${String(r.boards).padStart(3)} boards   ${ps}   MRR ${pct(r.mrr)}`;
}

// Both orderings over the SAME boards — the baseline is only meaningful as something to beat.
const boards = evalBoards();
const rankedBoards = evalBoards({ ranked: true });
if (boards.length === 0) {
  // Not a failure: a fresh clone or a wiped DB has no pursued postings yet, and there is nothing to
  // measure until the app has been used. Exit clean so this can sit in a script chain.
  console.log("No boards to score — no company has a posting you've pursued yet.");
  process.exit(0);
}

const { dev, test } = splitByCompany(boards, 0.7);
const rankedSplit = splitByCompany(rankedBoards, 0.7);
const positives = boards.reduce((n, b) => n + b.positives.size, 0);
const candidates = boards.reduce((n, b) => n + b.ranked.length, 0);

const rankable = boards.filter((b) => b.ranked.length > 1).length;

console.log(`\nScan ranker\n`);
console.log(`  ${boards.length} companies · ${candidates} postings · ${positives} pursued`);
console.log(`  ${rankable} companies have more than one posting — only those can score a ranking\n`);
console.log(`  ${"".padEnd(5)} ${"".padStart(3)}          ${KS.map((k) => `@${k} (boards scored)`).join("  ")}`.trimEnd());
console.log("  BASELINE  (id order — the floor to beat)");
console.log(line("dev", scoreBoards(dev, KS)));
console.log(line("test", scoreBoards(test, KS)));
console.log(line("all", scoreBoards(boards, KS)));

// The ranker can only be scored on postings that were RANKED and then agreed with. Agreeing removes
// a posting from triage, and the glance only ranks triage rows — so a positive keeps whatever rank
// it held at the moment you moved it, and has none at all if it was decided before the ranker
// existed. Scoring anyway sorts every unranked positive to the bottom of its board and reports the
// ranker as catastrophic, which is a statement about the missing data, not about the ranking.
const scorable = rankedBoards.filter((b) => [...b.positives].some((id) => b.postings.find((p) => p.id === id)?.rank != null));
console.log(`\n  RANKED    (glance_rank — the thing under test)`);
if (scorable.length < MIN_RANKED_BOARDS) {
  const withRank = boards.reduce((n, b) => n + [...b.positives].filter((id) => b.postings.find((p) => p.id === id)?.rank != null).length, 0);
  console.log(`  not scorable yet — ${withRank} of ${positives} agreed-with postings carry a rank (need ${MIN_RANKED_BOARDS} boards).`);
  console.log(`  This fills in going forward: rank first, then add to fit. Every pick out of the`);
  console.log(`  triage pile from now on is one scorable case.`);
} else {
  console.log(line("dev", scoreBoards(rankedSplit.dev, KS)));
  console.log(line("test", scoreBoards(rankedSplit.test, KS)));
  console.log(line("all", scoreBoards(rankedBoards, KS)));
}
// Filter precision — the other half, and the only one of the two that can be scored at all.
const fp = filterPrecision();
console.log(`\n  FILTER PRECISION  (of what it showed you, how much you wanted)`);
const era = currentProfileVersion();
console.log(`  since ${currentEvalSince().slice(0, 10)} — earlier decisions were about a filter, or preferences, that no longer apply`);
if (era) console.log(`  preference era v${era.version}, from ${era.effectiveFrom.slice(0, 10)} (changed: ${era.changed.join(", ")})`);
if (fp.precision === null) {
  console.log(`  not scorable yet — ${fp.decided} decisions (${fp.agreed} kept, ${fp.discarded} discarded), ${fp.undecided} still in triage.`);
} else {
  console.log(`  ${(fp.precision * 100).toFixed(0)}%  — ${fp.agreed} kept of ${fp.decided} decided, ${fp.undecided} still in triage`);
}
if (Object.keys(fp.byReason).length) {
  const parts = Object.entries(fp.byReason).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`);
  console.log(`  discarded because:  ${parts.join(" \u00b7 ")}`);
}

console.log(`
  Read these as a floor, not a score. Three distortions, all known:
  · A board with k or fewer postings is EXCLUDED from @k — the window is the whole board, so any
    ordering scores full marks. Most companies here have exactly one posting; counting them made
    this baseline read 0.84 @1, which measured "the company had one job", not the ranking.
  · A board is the company's WHOLE history, not one scan — 'scanned_at' is refreshed every pass, so a
    point-in-time board can't be rebuilt for existing rows. More distractors than were ever on screen
    at once means precision reads pessimistic. 'discovered_at' is now stamped on insert, so this
    fades as new rows land.
  · Positives all survived the current filter, so this can't see a good role the filter never
    surfaced. It measures ordering; it does not measure what was silently dropped.

  Compare versions against each other, not against 1.0.
`);
