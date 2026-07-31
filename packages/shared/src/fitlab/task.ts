import type { Criterion, Verdict } from "./types";

// The agent contract for a fit assessment — NO direct LLM API call. The app queues a `fitlab-assess`
// job; Claude Code (the agent) claims it, does the Extract + Detect reasoning itself, and submits verdicts
// over MCP. This is the cost-saving Claude-Code route: the app stays mechanical, the agent does judgment.

export const FITLAB_MODEL = "claude-code"; // who runs the judgment (the agent over MCP), not a paid API
export const PROMPT_VERSION = "v1";

const VERDICTS: Verdict[] = ["met", "partial", "unmet", "unclear", "na"];
export const normalizeVerdict = (v: unknown): Verdict => (VERDICTS.includes(v as Verdict) ? (v as Verdict) : "unclear");

// One verdict record the agent submits per criterion (the Output contract, mirrored in the playbook).
export type FitRecord = {
  runId: number;
  criterionKey: string;
  requirement: string; // what the JD demands for this criterion (the agent extracts it)
  verdict: Verdict;
  confidence: number; // 0–100
  evidence: string | null;
  reasoning: string | null;
};

// Render the self-contained instruction the agent follows. Everything it needs (rubric + profile + JD)
// is embedded so it needs no extra fetches; it returns one record per criterion.
export function buildFitTask(params: {
  runId: number; company: string; role: string; jd: string; profile: string;
  rubric: Pick<Criterion, "key" | "label" | "type" | "definition">[];
}): string {
  const criteria = params.rubric
    .map((c) => `- key="${c.key}" — ${c.label} [${c.type}]\n    ${c.definition}`)
    .join("\n");
  return [
    `Fit assessment (run ${params.runId}) — ${params.company} · ${params.role}.`,
    ``,
    `You are the Extract + Detect stage of a fit-assessment pipeline. For EACH criterion below:`,
    `  1. EXTRACT the posting's requirement for that dimension from the JD — one short phrase (or "none stated").`,
    `  2. JUDGE it against the CANDIDATE PROFILE → verdict ∈ met | partial | unmet | unclear | na.`,
    `Ground every verdict in specific profile evidence (a short quote). If the profile is silent, use`,
    `"unclear" — NOT "unmet". Report calibrated confidence 0–100; do not inflate it on thin evidence.`,
    `Do not output an overall score — the app computes the decision from your verdicts.`,
    ``,
    `CRITERIA:`,
    criteria,
    ``,
    `CANDIDATE PROFILE:`,
    params.profile,
    ``,
    `JOB DESCRIPTION:`,
    params.jd,
    ``,
    `Output — call submitJobResult(jobId, type:"fitlab-assess") with ONE record per criterion:`,
    `  { "runId": ${params.runId}, "criterionKey": "<key>", "requirement": "<JD phrase>",`,
    `    "verdict": "<met|partial|unmet|unclear|na>", "confidence": <0-100>,`,
    `    "evidence": "<short quote from the profile, or null>", "reasoning": "<one sentence>" }`,
  ].join("\n");
}
