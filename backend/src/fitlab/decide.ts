import type { Criterion, Decision, Verdict, VerdictRow } from "./types";

// The Decide stage — DETERMINISTIC. The LLM does perception (per-criterion verdicts); code does the
// decision. This is the key design choice: the score is reproducible, tunable without re-prompting,
// and every criterion stays a clean labelable unit. (Never ask the LLM for a 0–100 score directly.)

// How much a verdict counts toward a criterion's contribution. `unclear` is deliberately mid-low —
// the model hedged, so it shouldn't earn full credit. `na` is excluded from the score entirely.
const POINTS: Record<Verdict, number | null> = { met: 1, partial: 0.5, unclear: 0.4, unmet: 0, na: null };

// The label wins: a human override is the ground truth, so the decision recomputes off it.
export const effective = (v: VerdictRow): Verdict => v.humanVerdict ?? v.verdict;

// Confidence-band routing (what the Decide node visualizes): the model auto-decides the confident
// band; the uncertain band is what a production system would route to human review (and what active
// learning would prioritize for labeling). Threshold is a tunable knob — static for now.
export const CONFIDENCE_THRESHOLD = 70;

const ADVANCE_AT = 70;
const REVIEW_AT = 45;

export type DecideDetail = {
  contributions: { key: string; label: string; type: string; verdict: Verdict; points: number | null; weight: number }[];
  gateVetoes: string[]; // criterion keys whose gate failed (unmet) → forced drop
  uncertain: string[]; // criterion keys below the confidence band → would route to human
};

export type DecideResult = { score: number; decision: Decision; detail: DecideDetail };

// Aggregate verdicts → score + decision. Gates VETO (a clear miss drops regardless of score); the
// rest contribute a weighted average. Pure: same inputs → same output, so it's reproducible and testable.
export function decide(criteria: Criterion[], verdicts: VerdictRow[]): DecideResult {
  const byKey = new Map(criteria.map((c) => [c.key, c]));
  const contributions: DecideDetail["contributions"] = [];
  const gateVetoes: string[] = [];
  const uncertain: string[] = [];

  let weighted = 0;
  let weight = 0;
  for (const v of verdicts) {
    const c = byKey.get(v.criterionKey);
    if (!c || !c.active) continue;
    const ev = effective(v);
    const pts = POINTS[ev];
    if ((v.confidence ?? 100) < CONFIDENCE_THRESHOLD && !v.humanVerdict) uncertain.push(v.criterionKey);
    contributions.push({ key: c.key, label: c.label, type: c.type, verdict: ev, points: pts, weight: c.weight });
    if (c.type === "gate") {
      if (ev === "unmet") gateVetoes.push(c.key); // a clear gate miss vetoes
      continue; // gates don't contribute to the weighted score — they only veto
    }
    if (pts == null) continue; // na → excluded
    weighted += pts * c.weight;
    weight += c.weight;
  }

  const score = weight > 0 ? Math.round((weighted / weight) * 100) : 0;
  const decision: Decision = gateVetoes.length > 0 ? "drop" : score >= ADVANCE_AT ? "advance" : score >= REVIEW_AT ? "review" : "drop";
  return { score, decision, detail: { contributions, gateVetoes, uncertain } };
}
