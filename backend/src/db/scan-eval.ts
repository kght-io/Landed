import { eq } from "drizzle-orm";
import { db } from "./index";
import { companies, postings } from "./schema";
import type { RankedBoard } from "@landed/shared/experiments/ranking";

// Turns the posting store into the scan ranker's evaluation set: one board per company, carrying
// every posting ever seen there plus the ones the human actually pursued.
//
// The labels come from ACTIONS, never from a filter's own verdict — grading a filter against its
// own output would be circular. That also means the positives cost nothing to collect: they were
// recorded as a side effect of using the app long before any of this existed.
//
// Two known distortions, both stated rather than hidden:
//
// 1. **The board is the company's whole history, not one scan.** `scanned_at` is refreshed on every
//    rescan (it clusters on scan dates), so a point-in-time board can't be reconstructed for
//    anything already in the DB. Ranking against every posting ever seen is a strictly harder test —
//    more distractors than were ever on screen at once — so precision@k reads PESSIMISTIC. That is
//    fine for comparing two prompt versions against each other and wrong as an absolute score.
//    `discovered_at` is now stamped on insert, so this decays as new rows accumulate.
//
// 2. **Positives survived the current filter.** A role the mechanical filter wrongly dropped was
//    never seen, so it can never appear here. This set measures ordering and can lower-bound recall;
//    it cannot measure what the filter never surfaced.

// The SCAN stage's positive signal is "I added this to fit" — not "I eventually applied".
//
// That distinction was wrong here for a while and it made the eval unusable. Adding a posting to fit
// assessment IS the human agreeing with the glance, recorded at the moment of the decision, over the
// same population as the discards. Waiting for an application instead meant the label arrived weeks
// later, for a handful of rows, and attributed a FIT-stage rejection back to the scan — a posting
// dropped after reading the full JD says something about the fit assessment, not about the glance
// that surfaced it.
//
// So every state from `fit_queue` onward is a positive: the human said yes at this stage. A later
// rejection or ghosting is the COMPANY's decision, not a retraction, and treating those as negatives
// would delete most of the signal.
export const POSITIVE_STATES = [
  "fit_queue",
  "assessed",
  "apply_later",
  "tailoring",
  "tailored",
  "applied",
  "interview",
  "offer",
  "accepted",
  "rejected",
  "ghost",
] as const;

// Exported: db/pipeline-metrics.ts needs the same definition of "the human said yes", and two
// copies of that would drift into two different answers.
export const POSITIVE = new Set<string>(POSITIVE_STATES);

export type EvalBoard = RankedBoard & {
  /** Every posting on the board, richest-first ordering left to the caller (the ranker under test). */
  postings: { id: string; title: string; department: string | null; location: string | null; state: string; rank: number | null }[];
};

// One board per company that has at least one pursued posting. Companies with none are dropped
// rather than scored zero: with no posting worth surfacing there is no right answer to rank toward,
// so including them would only pad the denominator.
//
// Two orderings, and the difference between them IS the measurement:
//
//   default        — id ascending. A candidate LIST, not a ranking: the BASELINE the ranker has to
//                    beat. Scoring it measures the autoincrement, which is the point of a floor.
//   { ranked }     — the ranker's own order (`glance_rank`), which is the thing under test.
//
// Until this option existed the eval scored only the baseline and reported it as a result, so a
// ranker change could never show up either way.
export function evalBoards(opts: { ranked?: boolean } = {}): EvalBoard[] {
  const rows = db
    .select({
      id: postings.id,
      company: companies.name,
      title: postings.title,
      department: postings.department,
      location: postings.location,
      state: postings.state,
      glanceRank: postings.glanceRank,
    })
    .from(postings)
    .innerJoin(companies, eq(postings.companyId, companies.id))
    .all();

  const byCompany = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byCompany.get(r.company);
    if (list) list.push(r);
    else byCompany.set(r.company, [r]);
  }

  const boards: EvalBoard[] = [];
  for (const [company, list] of byCompany) {
    // Unranked rows sort AFTER ranked ones, never interleaved: the ranker not having seen a row is
    // not the same as it having ranked the row last.
    const sorted = opts.ranked
      ? [...list].sort((a, b) => {
          const ar = a.glanceRank ?? null;
          const br = b.glanceRank ?? null;
          if (ar !== null && br !== null) return ar - br;
          if (ar !== null) return -1;
          if (br !== null) return 1;
          return a.id - b.id;
        })
      : [...list].sort((a, b) => a.id - b.id);
    const positives = new Set(sorted.filter((r) => POSITIVE.has(r.state)).map((r) => String(r.id)));
    if (positives.size === 0) continue;
    boards.push({
      company,
      ranked: sorted.map((r) => String(r.id)),
      positives,
      postings: sorted.map((r) => ({
        id: String(r.id),
        title: r.title,
        department: r.department,
        location: r.location,
        state: r.state,
        rank: r.glanceRank ?? null,
      })),
    });
  }
  return boards.sort((a, b) => a.company.localeCompare(b.company));
}
