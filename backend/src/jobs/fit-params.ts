import type { Posting } from "@landed/shared/types";

// The fit record a tailoring job carries, projected off the posting.
//
// tailoring.md tells the agent to steer by the prior fit's gaps + leveling call, but nothing used to
// hand it over — so the agent went looking, burning ~7 requests per run walking sqlite schemas to
// find `postings.fit_score` / `fit_detail`. The data was on the Posting object all along.
//
// Lives in its own module because BOTH ends need it and they must not import each other: the
// enqueue path (jobs/enqueue/tailoring.ts) writes it into params, and the claim path (jobs/queue.ts)
// re-reads it. jobs/enqueue/tailoring.ts already imports createJob from jobs/queue.ts, so putting
// this in either one would close a cycle.
//
// Deliberately narrow. `summary` and `strengths` are prose the tailor re-derives in its own diff
// comments, and every token here is re-read on each of the run's ~14 requests — so only the fields
// that change which bullets get rewritten ride along. `level` is the fit's LEVELING CALL
// (levelMatch.call: match | stretch | under-leveled), not postings.level (the role's own rung).
// Returns undefined — never an empty object — when the posting was never scored: a hollow `fit: {}`
// reads as "scored, found nothing" and invites the agent to go looking for the real record.
export function fitForParams(p: Posting): Record<string, unknown> | undefined {
  const { fitScore, fit } = p;
  if (fitScore == null && !fit) return undefined;
  const out: Record<string, unknown> = {};
  if (fitScore != null) out.score = fitScore;
  if (fit?.levelMatch?.call) out.level = fit.levelMatch.call;
  if (fit?.levelMatch?.why) out.levelWhy = fit.levelMatch.why;
  if (fit?.recommendation) out.recommendation = fit.recommendation;
  if (fit?.gaps?.length) out.gaps = fit.gaps;
  return Object.keys(out).length ? out : undefined;
}

// Re-project the fit onto an existing params blob at claim time.
//
// Params are a SNAPSHOT taken when the job was queued, and a fit can land after that — in production
// a tailoring job was queued 6s after its fit job and claimed 67s before the fit finished. Claim time
// is the latest moment we control, so re-read there rather than trusting the snapshot. Returns null
// when nothing changed, so the caller can skip a pointless write.
export function paramsWithFit(
  params: Record<string, unknown>,
  posting: Posting,
): Record<string, unknown> | null {
  const list = params.postings;
  if (!Array.isArray(list) || !list.length) return null;
  const head = list[0] as Record<string, unknown>;
  const fit = fitForParams(posting);
  if (!fit) return null; // still unscored — leave the key absent rather than writing an empty one
  if (JSON.stringify(head.fit ?? null) === JSON.stringify(fit)) return null; // already current
  return { ...params, postings: [{ ...head, fit }, ...list.slice(1)] };
}
