import type { Criterion } from "./types";

// The starter rubric — stable criterion CATEGORIES. Per-posting requirement instances roll up into
// these, so verdicts aggregate across runs (what makes precision/recall computable). Editable later;
// this is just the cold-start set. `definition` is the judging instruction handed to the LLM.
//   gate   = hard veto (a clear miss drops the posting regardless of score)
//   must   = core fit, heavily weighted
//   nice   = bonus, lightly weighted
//   signal = soft indicator, lightly weighted
export const STARTER_CRITERIA: Omit<Criterion, "active">[] = [
  {
    key: "location",
    label: "Location",
    type: "gate",
    weight: 0,
    sortOrder: 0,
    definition:
      "Is the role workable from the candidate's location (from the profile's locations)? Onsite/hybrid in a metro the candidate can't work, or a region they're not eligible for, is a miss; a matching location or remote-in-region is met. If location is unstated, mark unclear.",
  },
  {
    key: "yoe-floor",
    label: "YoE floor",
    type: "gate",
    weight: 0,
    sortOrder: 1,
    definition:
      "Does the candidate clear the posting's minimum years-of-experience requirement? Compare the posting's floor against the candidate's years of experience (from the profile). Only an unusually high floor, or a domain-specific YoE the candidate lacks, is a miss. No floor stated → met.",
  },
  {
    key: "level-match",
    label: "Level match",
    type: "must",
    weight: 3,
    sortOrder: 2,
    definition:
      "Does the posting's level match the candidate's level (from the profile — e.g. Senior / Staff)? The candidate's band or an adjacent one is met/partial. Well above (Principal/Director) or a clear under-level (new-grad) is unmet; an adjacent stretch is partial.",
  },
  {
    key: "must-have-coverage",
    label: "Must-have coverage",
    type: "must",
    weight: 3,
    sortOrder: 3,
    definition:
      "What fraction of the posting's must-have technical requirements does the resume evidence? Full coverage = met, most = partial, a core must-have clearly missing = unmet. Judge against demonstrated experience, not keyword presence.",
  },
  {
    key: "domain-relevance",
    label: "Domain relevance",
    type: "signal",
    weight: 1,
    sortOrder: 4,
    definition:
      "How relevant is the candidate's domain background (from the profile) to the posting's domain? Strong overlap = met, adjacent = partial, unrelated = unmet.",
  },
  {
    key: "seniority-signal",
    label: "Seniority signal",
    type: "signal",
    weight: 1,
    sortOrder: 5,
    definition:
      "Does the posting want scope the candidate demonstrably has — cross-team technical leadership, ownership of org-level strategy, mentoring, 0→1 delivery? Clear match = met, neutral = partial, the posting wants something absent (e.g. people-management) = unmet.",
  },
];

// The candidate profile the Detect stage judges against — plain text so the LLM reads it directly
// (no PDF parsing in the request path). This is a GENERIC, fictional placeholder: the app replaces it
// with YOUR résumé automatically the first time you upload a base résumé (see /api/resume/upload,
// which auto-adopts the extracted text while the profile is still this untouched seed), or you can
// edit it on the page. Stored under the config key below. Do NOT commit a real résumé here.
export const PROFILE_CONFIG_KEY = "fitlab_profile";

export const PROFILE_SEED = `YOUR NAME — City, Region (or Remote)
Senior Software Engineer · ~6 years building customer-facing systems at scale. Replace this
placeholder with your own résumé — upload a base résumé (.docx) on the Profile page and the app
adopts its text here automatically, or edit this text directly.

EXPERIENCE
Senior Software Engineer · Example Corp (20XX – present)
- Owned an end-to-end service used by a large customer base; led design across backend and frontend.
- Drove a cross-team technical initiative and mentored other engineers.

Software Engineer · Another Company (20XX – 20XX)
- Shipped production features and built data/ML or platform pipelines with measurable impact.

PROJECTS
- A notable side project or open-source contribution.

SKILLS
Languages: (your languages). Backend / Cloud / Frontend / AI: (your stack).

EDUCATION
Degree · School.`;
