import { gte } from "drizzle-orm";
import { db } from "./index";
import { postings } from "./schema";
import { funnelStageOf } from "@landed/shared/pipeline/scan-funnel";
import { profileEraStart } from "./profile";
import { POSITIVE } from "./scan-eval";
import { callbackOutcome, fitBucket, MIN_DECIDED_FOR_RATE, type FitBucket } from "@landed/shared/experiments/prompts";

// The pipeline's LIVE quality metrics — what the Ops page reads.
//
// Split from ./scan-eval.ts, which is the ranker's eval HARNESS: that one builds a scored dataset
// for a CLI comparison between orderings, this one answers "is each stage agreeing with me right
// now". Different consumers, different cadence, and they were only in one file because they grew
// there.
//
// The rule every metric here follows: a rate is reported only with its denominator, and withheld
// entirely below a decision floor. 57% of 35 decisions is a different claim from 57% of 3,500, and
// a bare percentage reads as settled either way.

// ── the funnel ────────────────────────────────────────────────────────────────────────────────
// Where postings died on the way to the triage tab. Shown as one line above the Scan-results list,
// because it is the half of "how is the scan doing" you cannot get by looking at the screen: you can
// count what's in front of you, but not what was removed before it got there.

export type ScanFunnel = {
  fetched: number; // every posting the scan has ever filed
  mechanical: number; // dropped by stage 1's regex gates (incl. rows carrying retired reasons)
  glance: number; // dropped by the agent's level/discipline call
  you: number; // you discarded it at triage
  // Discarded before either actor left a marker. Reported rather than assigned: guessing would
  // quietly inflate whichever bucket got the benefit of the doubt, and this is the number that says
  // whether the pipeline is working.
  unattributed: number;
  triage: number; // sitting in the triage tab right now
  fit: number; // queued for or scored by the fit agent
  applied: number; // graduated to the tracker
  // The recall rule, made countable. `levelled` = got a level call at all; `widened` = the ladder was
  // ambiguous and the call kept EVERY band it might be rather than guessing. A gate that silently
  // declined to drop is indistinguishable from one that never looked, so the refusal is recorded.
  levelled: number;
  widened: number;
};

const TRIAGE_STATES = new Set(["matched", "review"]);
const FIT_STATES = new Set(["fit_queue", "assessed", "apply_later", "tailoring", "tailored"]);
const TRACKER = new Set(["applied", "interview", "offer", "accepted", "rejected", "ghost", "withdrawn", "company_skipped", "expired"]);

export function scanFunnel(): ScanFunnel {
  const rows = db
    .select({ state: postings.state, reason: postings.reason, bands: postings.glanceBands, dismissReason: postings.dismissReason })
    .from(postings)
    .all();

  let mechanical = 0, glance = 0, you = 0, triage = 0, fit = 0, applied = 0, levelled = 0, widened = 0, unattributed = 0;
  for (const r of rows) {
    // `filtered` is a rule's doing; `dismissed` is yours. Splitting on state rather than on reason
    // keeps "the machine dropped it" separate from "I threw it away" — they are different problems
    // and conflating them would hide whichever is actually costing more.
    if (r.state === "filtered") {
      if (funnelStageOf(r.reason) === "mechanical") mechanical++;
      else glance++;
    } else if (r.state === "dismissed") {
      // BOTH actors write `dismissed`, so state alone can't attribute it. The markers can:
      // your discard sets `dismiss_reason` (the chip), the agent's glance sets `reason` (prose).
      // Yours wins when both are present — a row the filter dropped that you later discarded is
      // your decision, and that's the later, more specific fact.
      if (r.dismissReason) you++;
      else if (r.reason) glance++;
      else unattributed++;
    }
    else if (TRIAGE_STATES.has(r.state)) triage++;
    else if (FIT_STATES.has(r.state)) fit++;
    else if (TRACKER.has(r.state)) applied++;

    if (r.bands) {
      levelled++;
      try {
        if ((JSON.parse(r.bands) as unknown[]).length > 1) widened++;
      } catch {
        // unreadable bands still count as levelled — the call happened, we just can't read its width
      }
    }
  }
  return { fetched: rows.length, mechanical, glance, you, triage, fit, applied, levelled, widened, unattributed };
}

// ── filter precision ──────────────────────────────────────────────────────────────────────────
// Of what the filter SURFACED, how much did the human actually want?
//
// This is the half of filter quality that can be scored at all. Both labels — "added to fit" and
// "discarded with a reason" — are produced over the same population at the same moment, so the
// denominator is honest. Its counterpart, RECALL ("of what it dropped, how much would I have
// wanted?"), has no such data: a dropped posting leaves no trace of whether it was wanted, which is
// why the only way to measure it is to sample the drops by hand.
//
// Scoped by `since` for a reason that bit once already: ~294 historical agreements predate the
// level/discipline changes, and scoring today's filter against decisions made about a DIFFERENT
// filter's output measures nothing.
//
// The scope is the PREFERENCE ERA, not a hardcoded date. A fixed date rots — it has to be bumped by
// hand whenever preferences move, and if it isn't the score silently mixes eras again. Editing a
// preference opens a new era (see db/profile.ts), so drift moves the boundary on its own: a `level`
// discard made while targeting Senior/Staff stops counting the moment that target changes, because
// it no longer describes what you want.

export type FilterPrecision = {
  agreed: number; // you moved it to fit — agreement with the glance
  discarded: number; // you discarded it with a reason — disagreement
  undecided: number; // still in triage; not evidence either way
  decided: number; // agreed + discarded, the denominator
  precision: number | null; // null until `decided` clears the floor
  byReason: Record<string, number>; // WHERE it's failing — more actionable than the rate
};

// The day the level/discipline gates moved to stage 2 and the ladder maps landed. A floor, not the
// scope: the pipeline itself changed here, so nothing earlier is comparable however stable the
// preferences were.
export const CURRENT_FILTER_SINCE = "2026-09-04";

// The scope actually used: whichever is later — the pipeline change, or the current preference era.
// Both have to hold for a decision to say something about today's filter.
export const currentEvalSince = (): string => {
  const era = profileEraStart();
  return era > CURRENT_FILTER_SINCE ? era : CURRENT_FILTER_SINCE;
};

export function filterPrecision(opts: { since?: string; minDecided?: number } = {}): FilterPrecision {
  const since = opts.since ?? currentEvalSince();
  // Same bar as experiments/prompts.ts MIN_DECIDED_FOR_RATE: a rate over a handful is noise wearing
  // a number, and this one would be read as a verdict on the whole pipeline.
  const minDecided = opts.minDecided ?? 10;

  const rows = db
    .select({ state: postings.state, dismissReason: postings.dismissReason })
    .from(postings)
    .where(gte(postings.scannedAt, since))
    .all();

  let agreed = 0, discarded = 0, undecided = 0;
  const byReason: Record<string, number> = {};
  for (const r of rows) {
    if (POSITIVE.has(r.state)) agreed++;
    else if (r.dismissReason) {
      discarded++;
      byReason[r.dismissReason] = (byReason[r.dismissReason] ?? 0) + 1;
    } else if (TRIAGE_STATES.has(r.state)) undecided++;
  }

  const decided = agreed + discarded;
  return {
    agreed, discarded, undecided, decided,
    precision: decided >= minDecided ? agreed / decided : null,
    byReason,
  };
}

// ── fit agreement ─────────────────────────────────────────────────────────────────────────────
// Does the score agree with what you did, and WHICH WAY does it fail?
//
// Two earlier versions of this were wrong in instructive ways:
//
//   v1 measured "how many advanced past fit" and called it precision. That punished the pipeline for
//      working — 13 of the first era's 16 post-fit drops were low-scored roles fit had correctly
//      binned, and you agreed. A metric that scores the assessment worse the better it filters is
//      worse than none.
//   v2 merged every agreement into one accuracy figure. That read 72% while the real recall was 44%,
//      because most decisions are DROPS and correctly binning an obvious reject is the easy half.
//      One number hid the only failure that costs anything.
//
// So the full confusion matrix, and both rates:
//   precision — of what fit said advance, how much you advanced. A false positive is a full-JD run
//               spent on a posting the assessment should have caught. Costs money.
//   recall    — of what you advanced, how much fit said advance. A false negative is a job you WANTED
//               that scored below the bar. Costs you the job. This is the one to watch.

const ADVANCED_PAST_FIT = new Set(["tailoring", "tailored", "apply_later", "applied", "interview", "offer", "accepted", "rejected", "ghost"]);
const IN_FIT = new Set(["fit_queue", "assessed"]);
// The same bar decide() uses to say `advance`, so agreement is measured against the threshold the
// pipeline actually acts on rather than a second one invented here.
const FIT_ADVANCE_AT = 70;

export type FitAgreement = {
  truePositives: number; // fit said advance, you advanced
  trueNegatives: number; // fit said drop, you dropped
  falsePositives: number; // fit said advance, you dropped — wasted a full-JD run
  falseNegatives: number; // fit said drop, you took it anyway — a job it would have cost you
  pending: number; // still in fit; not evidence either way
  decided: number;
  precision: number | null; // null below the floor
  recall: number | null;
  accuracy: number | null; // reported, but never on its own — the trues dominate it
};

export function fitAgreement(opts: { since?: string; minDecided?: number } = {}): FitAgreement {
  const since = opts.since ?? currentEvalSince();
  const minDecided = opts.minDecided ?? 10;
  const rows = db
    .select({ state: postings.state, fitScore: postings.fitScore })
    .from(postings)
    .where(gte(postings.scannedAt, since))
    .all();

  let tp = 0, tn = 0, fp = 0, fn = 0, pending = 0;
  for (const r of rows) {
    if (IN_FIT.has(r.state)) { pending++; continue; }
    // Only a posting the assessment actually scored can say anything about the assessment.
    if (r.fitScore == null) continue;

    const advanced = ADVANCED_PAST_FIT.has(r.state);
    const dropped = r.state === "dismissed";
    if (!advanced && !dropped) continue; // no decision yet

    const saidAdvance = r.fitScore >= FIT_ADVANCE_AT;
    if (saidAdvance && advanced) tp++;
    else if (!saidAdvance && dropped) tn++;
    else if (saidAdvance && dropped) fp++;
    else fn++;
  }

  const decided = tp + tn + fp + fn;
  const rate = (num: number, den: number) => (decided >= minDecided && den > 0 ? num / den : null);
  return {
    truePositives: tp, trueNegatives: tn, falsePositives: fp, falseNegatives: fn,
    pending, decided,
    precision: rate(tp, tp + fp),
    recall: rate(tp, tp + fn),
    accuracy: rate(tp + tn, decided),
  };
}

// ── callback by fit score ─────────────────────────────────────────────────────────────────────
// The only end-to-end truth signal there is: does a high score actually convert?
//
// If an 84 and a 61 call back at the same rate, the score isn't measuring anything — however
// coherent its verdicts look. This is the one metric no amount of internal consistency can fake,
// because the answer comes from companies, not from the pipeline.
//
// Reuses callbackOutcome/fitBucket from shared/src/experiments/prompts.ts rather than re-deriving
// "what counts as a callback": two definitions of that would drift, and one of them would be wrong.

export type CallbackBand = {
  bucket: FitBucket;
  applications: number; // scored applications in this band
  decided: number; // those whose outcome is settled (excludes `pending`)
  callbacks: number;
  rate: number | null; // null below the floor — a rate over three applications is noise
};

export function callbackByFitScore(opts: { minDecided?: number; now?: Date } = {}): CallbackBand[] {
  const minDecided = opts.minDecided ?? MIN_DECIDED_FOR_RATE;
  const now = opts.now ?? new Date();
  const rows = db
    .select({
      state: postings.state,
      fitScore: postings.fitScore,
      appliedAt: postings.appliedDate,
      interviewed: postings.interviewed,
      fitPromptVersionId: postings.fitPromptVersionId,
      tailorPromptVersionId: postings.tailorPromptVersionId,
      postingId: postings.id,
    })
    .from(postings)
    .all();

  const bands = new Map<FitBucket, { applications: number; decided: number; callbacks: number }>();
  for (const b of ["80+", "60-79", "40-59", "<40"] as FitBucket[]) bands.set(b, { applications: 0, decided: 0, callbacks: 0 });

  for (const r of rows) {
    // No score → no band to put it in. Deliberately not lumped into a catch-all, which would make
    // every band's denominator depend on how much of the backlog happened to be unscored.
    if (r.fitScore == null) continue;
    const bucket = fitBucket(r.fitScore);
    const band = bands.get(bucket);
    if (!band) continue;

    const outcome = callbackOutcome(r, now);
    if (outcome === "excluded") continue; // never submitted, or you closed it yourself
    band.applications++;
    if (outcome === "pending") continue; // applied too recently for silence to mean anything
    band.decided++;
    if (outcome === "callback") band.callbacks++;
  }

  return [...bands.entries()].map(([bucket, b]) => ({
    bucket,
    applications: b.applications,
    decided: b.decided,
    callbacks: b.callbacks,
    rate: b.decided >= minDecided ? b.callbacks / b.decided : null,
  }));
}
