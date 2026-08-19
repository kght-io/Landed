import { eq } from "drizzle-orm";
import { db } from "./index";
import { companies, postings, promptVersions } from "./schema";
import {
  APPLIED_STATES,
  CALLBACK_WINDOW_DAYS,
  callbackOutcome,
  fitBucket,
  type FitBucket,
  type Outcome,
} from "@landed/shared/experiments/prompts";

// The raw record behind the prompt experiment: one row per application, carrying the dimensions a
// comparison would eventually group by (which prompt version produced the fit and the tailor, the
// fit score) next to the outcome.
//
// It stays raw ON PURPOSE. The first stamped runs are only now landing, so any summary this shipped
// with would be a guess at which cut matters — and a wrong summary is harder to unlearn than no
// summary. Classification per row is the part that's actually settled (see the shared module), so
// that's the part that's computed.

export type VersionMeta = { id: number; feature: string; version: number; label: string | null; archived: boolean };
export type ExperimentRow = {
  postingId: number;
  company: string;
  role: string;
  appliedAt: string | null;
  state: string;
  interviewed: boolean;
  fitScore: number | null;
  fitBucket: FitBucket;
  fitPromptVersionId: number | null;
  tailorPromptVersionId: number | null;
  tailored: boolean;
  outcome: Outcome;
};
export type PromptExperiments = {
  rows: ExperimentRow[]; // newest application first
  versions: VersionMeta[]; // id → v-number + label, for the two version columns
  windowDays: number; // how long silence waits before it counts as a no
};

export function promptExperiments(now: Date = new Date()): PromptExperiments {
  const raw = db
    .select({
      postingId: postings.id,
      company: companies.name,
      role: postings.title,
      appliedAt: postings.appliedDate,
      state: postings.state,
      interviewed: postings.interviewed,
      fitScore: postings.fitScore,
      fitPromptVersionId: postings.fitPromptVersionId,
      tailorPromptVersionId: postings.tailorPromptVersionId,
      resumeDir: postings.resumeDir,
    })
    .from(postings)
    .innerJoin(companies, eq(postings.companyId, companies.id))
    .all()
    // Only postings that actually reached an applied stage. A stray appliedDate on something still
    // in discovery is not a submitted application (same guard db/dashboard.ts applies).
    .filter((r) => !!r.appliedAt && APPLIED_STATES.has(r.state));

  const rows: ExperimentRow[] = raw
    .map(({ resumeDir, ...r }) => ({
      ...r,
      fitBucket: fitBucket(r.fitScore),
      tailored: !!resumeDir,
      outcome: callbackOutcome(r, now),
    }))
    .sort((a, b) => (b.appliedAt ?? "").localeCompare(a.appliedAt ?? ""));

  const versions: VersionMeta[] = db
    .select({
      id: promptVersions.id,
      feature: promptVersions.feature,
      version: promptVersions.version,
      label: promptVersions.label,
      archived: promptVersions.archived,
    })
    .from(promptVersions)
    .all();

  return { rows, versions, windowDays: CALLBACK_WINDOW_DAYS };
}
