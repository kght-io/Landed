import { KEYWORD_AXES, type KeywordAxis } from "./dismiss";
import { termMatcher } from "./exclude";

// Turn a labelled discard into a proposed filter rule.
//
// The discard already answers the hard half: `stack mismatch` says WHICH axis the rejection was
// about. The missing half is the keyword, and it is sitting in the title of the thing just thrown
// away. Without this the labels only ever feed the eval — you tell the system "wrong stack" a dozen
// times and it keeps showing you iOS roles, because nothing carries the judgment back into the
// profile the glance actually reads.
//
// **A lookup, not a model call.** A suggestion that arrives after the popup closed is worse than
// none, and every LLM call in this app goes through the job queue, which is asynchronous by design.
// The cost of a fixed vocabulary is that it misses unusual terms — so the popup also takes free text
// (see ExcludeSuggest.tsx). The vocabulary earns its keep on the common case, which is most of them.
//
// The vocabulary is a SEED, not the filter. Nothing here is a hard drop: these terms land on the
// profile, which the glance and the fit rubric read as guidance. That is deliberate — a keyword that
// silently removed postings would reintroduce exactly the unobservable false negatives the level
// gate was taken out for.
//
// Aliases are matched with the same grammar as the scan's own term lists (termMatcher): whole words,
// so `Go` never fires inside `Google` nor `React` inside `Reactor`, and hyphen ≡ space. One grammar,
// so a suggestion you accept can't mean something different from how the scan would read it.

type Term = {
  /** What gets written to the profile. One canonical spelling per concept, so the axis doesn't accumulate `iOS`, `ios` and `iPhone` as three rules. */
  label: string;
  /** Every way a posting title says it. */
  aliases: string[];
};

// ── the vocabulary ────────────────────────────────────────────────────────────────────────────
// Scoped to what survives stage 1: the mechanical filter already drops security, analyst, solutions
// and the rest of the profile's default `excludeTitleTerms`, so listing them here would offer rules
// for postings that never reach a human. What's left is the judgment calls — the ones the labels
// were introduced to capture.
const VOCAB: Record<KeywordAxis, Term[]> = {
  // A different JOB. The title says engineer and the seniority fits; it just isn't the work.
  role: [
    { label: "SRE", aliases: ["SRE", "site reliability", "production engineer", "reliability engineer"] },
    { label: "DevOps", aliases: ["devops", "build engineer", "release engineer"] },
    // Bare `ML` is here because the spelled-out aliases missed the common case: "Software Engineer, ML
    // Platform" and "SWE, ML Infrastructure" both name the discipline with the initialism alone.
    // Word-boundary matching makes it safe (it can't fire inside HTML/XML). Bare `AI` is deliberately
    // NOT an alias — at an AI lab it appears on core infrastructure roles that are squarely a match.
    { label: "ML / AI research", aliases: ["machine learning", "ML", "MLOps", "ML engineer", "research engineer", "research scientist", "deep learning", "AI research"] },
    { label: "data engineering", aliases: ["data engineer", "data engineering", "ETL", "data platform engineer", "analytics engineer"] },
    { label: "QA / test", aliases: ["QA", "quality engineer", "test engineer", "SDET", "automation engineer"] },
    { label: "developer relations", aliases: ["developer relations", "devrel", "developer advocate"] },
    { label: "IT / sysadmin", aliases: ["sysadmin", "system administrator", "IT engineer"] },
    { label: "hardware / embedded", aliases: ["embedded", "firmware", "hardware engineer", "robotics"] },
  ],
  // The same job on the wrong TECHNOLOGY. Squarely software engineering, wrong tools.
  stack: [
    { label: "iOS", aliases: ["iOS", "iPhone", "Swift", "SwiftUI"] },
    { label: "Android", aliases: ["Android", "Kotlin"] },
    { label: "mobile", aliases: ["mobile", "React Native", "Flutter"] },
    { label: "frontend", aliases: ["frontend", "front end", "web UI", "React", "Angular", "Vue", "design systems"] },
    { label: "C++", aliases: ["C++", "CPP"] },
    { label: "Go", aliases: ["Go", "Golang"] },
    { label: "Java", aliases: ["Java", "JVM", "Scala"] },
    { label: ".NET", aliases: [".NET", "C#", "dotnet"] },
    { label: "Rust", aliases: ["Rust"] },
    { label: "graphics", aliases: ["graphics", "rendering", "shader", "GPU", "CUDA", "Metal"] },
    { label: "compilers / PL", aliases: ["compiler", "compilers", "programming language", "formal methods", "LLVM", "type system"] },
    { label: "kernel / systems", aliases: ["kernel", "driver", "firmware engineer", "Linux kernel"] },
    { label: "game engines", aliases: ["Unity", "Unreal", "game engine"] },
    { label: "Salesforce / SAP", aliases: ["Salesforce", "SAP", "ServiceNow", "Workday"] },
  ],
  // The same job and stack, a problem space you don't want to spend years on.
  domain: [
    { label: "ads", aliases: ["ads", "advertising", "ad platform", "adtech", "monetization"] },
    { label: "payments", aliases: ["payments", "billing", "checkout", "payouts"] },
    { label: "growth", aliases: ["growth", "acquisition", "retention", "engagement"] },
    { label: "marketing", aliases: ["marketing", "martech", "CRM", "campaign"] },
    { label: "trust & safety", aliases: ["trust & safety", "trust and safety", "moderation", "abuse", "fraud"] },
    { label: "crypto / blockchain", aliases: ["crypto", "blockchain", "web3", "defi", "wallet", "ethereum"] },
    { label: "gaming", aliases: ["gaming", "games", "esports"] },
    { label: "healthcare", aliases: ["healthcare", "clinical", "EHR", "patient", "health system"] },
    { label: "e-commerce", aliases: ["e-commerce", "ecommerce", "commerce", "marketplace", "retail"] },
    { label: "logistics", aliases: ["logistics", "supply chain", "fulfillment", "warehouse", "delivery ops"] },
    { label: "search / ranking", aliases: ["search", "ranking", "relevance", "recommendation", "recsys"] },
    { label: "social", aliases: ["social", "feed", "creator", "community"] },
  ],
};

// Each term's aliases compiled once, at load — the vocabulary is static, and suggestExclusions runs on
// every labelled discard.
const MATCHERS: Record<KeywordAxis, { term: Term; match: (text: string) => boolean }[]> = {
  role: VOCAB.role.map((term) => ({ term, match: termMatcher(term.aliases) })),
  stack: VOCAB.stack.map((term) => ({ term, match: termMatcher(term.aliases) })),
  domain: VOCAB.domain.map((term) => ({ term, match: termMatcher(term.aliases) })),
};

// How many to offer. A menu of four is still one click; a menu of twelve is a reading task, and the
// popup exists precisely because a form would not get filled in.
const MAX_SUGGESTIONS = 4;

/**
 * Terms worth adding to `axis`, drawn from the discarded postings' text.
 *
 * `texts` — one string per posting (title, plus department if you have it; concatenating is fine).
 * `already` — what the axis already excludes, so a live rule is never offered twice. Matched loosely:
 * an existing `mobile (iOS / Android)` entry suppresses `iOS`, because the user has clearly already
 * said this, whatever spelling they said it in.
 *
 * Ranked by how many of the postings carry the term. On a bulk discard that ordering IS the signal —
 * selecting rows that share a reason is what makes a batch label meaningful, so the term the batch
 * shares is the one the user means.
 */
export function suggestExclusions(axis: KeywordAxis, texts: string[], already: string[]): string[] {
  if (!(KEYWORD_AXES as readonly string[]).includes(axis)) return [];
  const haystacks = texts.map((t) => t ?? "").filter((t) => t.trim());
  if (!haystacks.length) return [];

  const excluded = already.map((a) => a.toLowerCase());
  const hits: { label: string; n: number }[] = [];

  for (const { term, match } of MATCHERS[axis]) {
    // A term already covered by an existing rule is not a suggestion. Checked against the term's
    // aliases too, so `mobile (iOS / Android)` on the axis suppresses the `iOS` term as well.
    if (excluded.some((e) => e.includes(term.label.toLowerCase()) || term.aliases.some((a) => e.includes(a.toLowerCase())))) continue;
    const n = haystacks.filter(match).length;
    if (n) hits.push({ label: term.label, n });
  }

  // Count descending; ties keep vocabulary order, which reads specific-before-general (`iOS` before
  // `mobile`) so the narrower rule is the one offered first.
  return hits.sort((a, b) => b.n - a.n).slice(0, MAX_SUGGESTIONS).map((h) => h.label);
}

/**
 * Best-effort axis for a term from the retired single `excludeDisciplines` list — used once, to split
 * a legacy profile. Unrecognised terms go to `role`: it is the broadest of the three, and putting a
 * term on the wrong axis is recoverable in one click while dropping it silently loosens the filter
 * with nothing to notice.
 */
export function axisForTerm(term: string): KeywordAxis {
  for (const axis of ["stack", "domain"] as const) {
    if (MATCHERS[axis].some(({ term: t, match }) => match(term) || termMatcher([t.label])(term))) return axis;
  }
  return "role";
}
