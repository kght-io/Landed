// Fit Lab — shared types. The lab models fit assessment as a production classification pipeline;
// these types are the contract between the assess pipeline (lib/fitlab/assess.ts), the store, the
// API routes, and the UI. See lib/fitlab/README intent in lib/db/schema.ts.

export type CriterionType = "gate" | "must" | "nice" | "signal";
// A graded verdict, not a bare boolean — "partial"/"unclear" carry the ambiguity the model actually
// has, which is what makes confidence-band routing and calibration meaningful downstream.
export type Verdict = "met" | "partial" | "unmet" | "unclear" | "na";
export type Decision = "advance" | "review" | "drop";

export type Criterion = {
  key: string;
  label: string;
  type: CriterionType;
  weight: number;
  definition: string;
  active: boolean;
  sortOrder: number;
};

// One stage's trace entry — what the trace view replays. `artifact` is the stage's output (the
// extracted requirements, the raw verdicts, the decision math), kept opaque so each stage owns its shape.
export type StageTrace = { stage: string; ms: number; artifact: unknown };

export type VerdictRow = {
  id: number;
  runId: number;
  criterionKey: string;
  requirement: string | null;
  type: CriterionType;
  verdict: Verdict;
  confidence: number | null; // 0–100
  evidence: string | null;
  reasoning: string | null;
  humanVerdict: Verdict | null; // the label
  humanNote: string | null;
  labeledAt: string | null;
};

export type Run = {
  id: number;
  postingId: number | null;
  company: string;
  role: string;
  jd: string;
  model: string;
  promptVersion: string;
  score: number | null;
  decision: Decision | null;
  stages: StageTrace[];
  createdAt: string;
  verdicts: VerdictRow[];
};

// The Detect stage's per-criterion output, before it's persisted as a VerdictRow.
export type DetectResult = {
  criterionKey: string;
  verdict: Verdict;
  confidence: number;
  evidence: string | null;
  reasoning: string | null;
};
